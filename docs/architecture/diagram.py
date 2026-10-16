"""
Architecture diagram as code (https://diagrams.mingrammer.com).

    pip install diagrams      # also needs Graphviz: apt install graphviz / brew install graphviz
    python docs/architecture/diagram.py   # -> docs/architecture/architecture.png

Numbered edge labels match the "Architecture" walkthrough in README.md.
"""
from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import Lambda
from diagrams.generic.blank import Blank
from diagrams.aws.database import Dynamodb
from diagrams.aws.integration import Eventbridge, SimpleNotificationServiceSns, SimpleQueueServiceSqs
from diagrams.aws.management import Cloudformation, Cloudwatch
from diagrams.aws.mobile import Amplify, APIGateway
from diagrams.aws.security import Cognito, IAMRole, SecretsManager
from diagrams.onprem.ci import GithubActions
from diagrams.onprem.client import User, Users
from diagrams.onprem.vcs import Github

OUT = Path(__file__).with_name("architecture")

graph_attr = {
    "fontsize": "22",
    "pad": "0.6",
    "splines": "spline",
    "nodesep": "0.65",
    "ranksep": "1.1",
    "labelloc": "t",
}
edge_attr = {"fontsize": "11"}

# Edge styles (also shown in the legend)
REQUEST = {"color": "#1f4e8c"}                                 # synchronous user/API traffic
EVENT = {"color": "#b35900", "style": "bold"}                  # async event-driven flow
FAILURE = {"color": "#c0392b", "style": "dashed"}              # retries exhausted -> DLQ
DEPLOY = {"color": "#555555", "style": "dashed"}               # CI/CD & provisioning
OBSERVE = {"color": "#2e7d32", "style": "dotted"}              # logs / metrics


def e(label="", **style):
    return Edge(label=label, **style)


with Diagram(
    "Serverless To-Do - event-driven task expiry (AWS, eu-central-1)",
    filename=str(OUT),
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=graph_attr,
    edge_attr=edge_attr,
):
    user = User("User\n(browser)")
    inbox = Users("Task owner's\ninbox")

    # ------------------------------------------------------------ CI/CD
    with Cluster("GitHub  -  Eric-Obeng/serverless-todo"):
        repo = Github("repo\nfeature/* → develop → main\n(main protected: PR only)")
        with Cluster("GitHub Actions"):
            ci = GithubActions("CI\n(PRs: tests, build,\nsam validate)")
            deploy_dev = GithubActions("Deploy dev\n(push develop)")
            deploy_prod = GithubActions("Deploy prod\n(push main)")

    with Cluster("AWS account  -  eu-central-1"):
        with Cluster("Bootstrap stack (once per account)"):
            oidc_role = IAMRole("GitHub OIDC\ndeploy role")
            apigw_logs_role = IAMRole("API Gateway\nCloudWatch role")
            gh_token = SecretsManager("GitHub token\n(for Amplify)")

        cfn = Cloudformation("SAM / CloudFormation\nserverless-todo-dev\nserverless-todo-prod")

        # ------------------------------------------------ one environment
        with Cluster("Per-environment stack (dev and prod are identical, isolated copies)"):
            amplify = Amplify("Amplify Hosting\nReact SPA\n(env vars from SAM)")

            with Cluster("Authentication"):
                cognito = Cognito("Cognito User Pool\nemail + password")
                pre_signup = Lambda("PreSignUp\nauto-confirm")
                post_auth = Lambda("PostAuthentication\nsubscribe email")

            with Cluster("API (REST)"):
                apigw = APIGateway("API Gateway\nCognito authorizer")
                api_fn = Lambda("Tasks API\nExpress CRUD")

            table = Dynamodb(
                "DynamoDB (on-demand)\nsingle table + GSI1\nPK USER#sub · SK TASK#id\nStreams NEW_AND_OLD"
            )

            with Cluster("Expiry workflow"):
                scheduler = Eventbridge("EventBridge Scheduler\none-time at(deadline)\nper task")
                expire_fn = Lambda("ExpireTask\nPending → Expired")
                sched_dlq = SimpleQueueServiceSqs("Scheduler DLQ")

            sns = SimpleNotificationServiceSns("SNS topic\nfilter policy: userId")

            with Cluster("Cancellation workflow (decoupled, idempotent)"):
                router_fn = Lambda("StreamRouter\nfilter: deleted /\nPending → Completed")
                fifo = SimpleQueueServiceSqs("SQS FIFO\ngroup = taskId\ndedup = stream eventID")
                cancel_fn = Lambda("CancelExpiry\nre-checks task state")
                fifo_dlq = SimpleQueueServiceSqs("FIFO DLQ")

            cw = Cloudwatch("CloudWatch\nJSON logs · metrics\nalarms · dashboard · X-Ray")

    # ------------------------------------------------------------ deploy
    repo >> e("PR", **DEPLOY) >> ci
    repo >> e("merge develop", **DEPLOY) >> deploy_dev
    repo >> e("merge main", **DEPLOY) >> deploy_prod
    deploy_dev >> e("OIDC (no keys)", **DEPLOY) >> oidc_role
    deploy_prod >> e("OIDC (no keys)", **DEPLOY) >> oidc_role
    oidc_role >> e("sam deploy", **DEPLOY) >> cfn
    cfn >> e("provisions", **DEPLOY) >> amplify
    gh_token >> e("repo access", **DEPLOY) >> amplify
    repo >> e("Amplify build", **DEPLOY) >> amplify
    apigw_logs_role >> e("", **DEPLOY) >> apigw

    # ------------------------------------------------------------ auth
    user >> e("① load app", **REQUEST) >> amplify
    user >> e("② sign up / sign in", **REQUEST) >> cognito
    cognito >> e("PreSignUp", **REQUEST) >> pre_signup
    cognito >> e("PostAuthentication", **REQUEST) >> post_auth
    post_auth >> e("③ Subscribe(email,\nuserId filter)", **REQUEST) >> sns

    # ------------------------------------------------------------ CRUD
    user >> e("④ REST + ID token", **REQUEST) >> apigw
    apigw >> e("verify JWT", style="dotted", color="#1f4e8c") >> cognito
    apigw >> e("proxy", **REQUEST) >> api_fn
    api_fn >> e("⑤ CRUD", **REQUEST) >> table
    api_fn >> e("⑥ CreateSchedule\n(deadline, default +5 min)", **REQUEST) >> scheduler

    # ------------------------------------------------------------ expiry
    scheduler >> e("⑦ at deadline", **EVENT) >> expire_fn
    expire_fn >> e("⑧ conditional update\nPending → Expired", **EVENT) >> table
    expire_fn >> e("⑨ Publish(userId)", **EVENT) >> sns
    sns >> e("⑩ email", **EVENT) >> inbox
    scheduler >> e("", **FAILURE) >> sched_dlq

    # ------------------------------------------------------------ cancellation
    table >> e("Ⓐ stream", **EVENT) >> router_fn
    router_fn >> e("Ⓑ SendMessage", **EVENT) >> fifo
    fifo >> e("Ⓒ", **EVENT) >> cancel_fn
    cancel_fn >> e("Ⓓ GetItem\n(still Pending?)", **EVENT) >> table
    cancel_fn >> e("Ⓔ DeleteSchedule", **EVENT) >> scheduler
    fifo >> e("5 failures", **FAILURE) >> fifo_dlq

    # ------------------------------------------------------------ observability
    for node in (api_fn, expire_fn, router_fn, cancel_fn, post_auth, apigw):
        node >> e("", **OBSERVE) >> cw

    # ------------------------------------------------------------ legend
    with Cluster("Legend"):
        for label, style in (
            ("request / API call", REQUEST),
            ("async event", EVENT),
            ("retries exhausted -> DLQ", FAILURE),
            ("deploy / provision", DEPLOY),
            ("logs & metrics", OBSERVE),
        ):
            Blank("", width="0.1", height="0.1") >> e(label, **style) >> Blank("", width="0.1", height="0.1")
