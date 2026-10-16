"""
Architecture diagram as code (https://diagrams.mingrammer.com).

    pip install diagrams      # also needs Graphviz: apt install graphviz / brew install graphviz
    python docs/architecture/diagram.py   # -> docs/architecture/architecture.png
"""
from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.devtools import Codepipeline
from diagrams.aws.integration import Eventbridge, SimpleNotificationServiceSns, SimpleQueueServiceSqs
from diagrams.aws.management import Cloudwatch, Cloudformation
from diagrams.aws.mobile import Amplify, APIGateway
from diagrams.aws.security import Cognito, IAMRole
from diagrams.onprem.client import User
from diagrams.onprem.vcs import Github

OUT = Path(__file__).with_name("architecture")

graph_attr = {"fontsize": "20", "pad": "0.5", "splines": "spline", "nodesep": "0.7", "ranksep": "1.0"}

with Diagram(
    "Serverless To-Do - Event-Driven Expiry",
    filename=str(OUT),
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=graph_attr,
):
    user = User("User\n(browser)")
    inbox = User("User inbox")

    with Cluster("CI/CD"):
        repo = Github("GitHub repo")
        pipeline = Codepipeline("GitHub Actions\nsam build/deploy")
        cfn = Cloudformation("SAM / CloudFormation\nstack")
        repo >> pipeline >> cfn

    with Cluster("AWS Cloud (region)"):
        amplify = Amplify("Amplify Hosting\nReact SPA")

        with Cluster("Authentication"):
            cognito = Cognito("Cognito\nUser Pool")
            pre_signup = Lambda("PreSignUp\n(auto-confirm)")
            post_auth = Lambda("PostAuthentication\n(subscribe email)")

        with Cluster("API"):
            apigw = APIGateway("API Gateway (REST)\nCognito authorizer")
            api_fn = Lambda("Tasks API\n(Express)")

        table = Dynamodb("DynamoDB Tasks\n(single table + GSI1)\nStreams: NEW_AND_OLD")

        with Cluster("Expiry workflow"):
            scheduler = Eventbridge("EventBridge Scheduler\none-time at(deadline)")
            sched_role = IAMRole("Scheduler role")
            expire_fn = Lambda("ExpireTask")
            sched_dlq = SimpleQueueServiceSqs("Scheduler DLQ")

        with Cluster("Cancellation workflow"):
            router_fn = Lambda("StreamRouter")
            fifo = SimpleQueueServiceSqs("cancel-expiry.fifo")
            fifo_dlq = SimpleQueueServiceSqs("cancel-expiry-dlq.fifo")
            cancel_fn = Lambda("CancelExpiry")

        sns = SimpleNotificationServiceSns("SNS topic\n(filter: userId)")
        cw = Cloudwatch("CloudWatch\nLogs, metrics,\nalarms, dashboard")

    # Deployment
    cfn >> Edge(style="dashed", color="gray") >> amplify
    repo >> Edge(style="dashed", color="gray", label="build") >> amplify

    # Auth
    user >> Edge(label="HTTPS") >> amplify
    user >> Edge(label="sign up / sign in (SRP)") >> cognito
    cognito >> pre_signup
    cognito >> post_auth >> Edge(label="Subscribe(email)") >> sns

    # CRUD
    user >> Edge(label="REST + ID token") >> apigw >> api_fn
    apigw >> Edge(style="dotted", label="validate JWT") >> cognito
    api_fn >> Edge(label="CRUD") >> table
    api_fn >> Edge(label="CreateSchedule") >> scheduler

    # Expiry
    scheduler >> Edge(label="at deadline") >> sched_role >> expire_fn
    scheduler >> Edge(style="dashed", color="red") >> sched_dlq
    expire_fn >> Edge(label="Pending -> Expired") >> table
    expire_fn >> Edge(label="Publish") >> sns >> Edge(label="email") >> inbox

    # Cancellation
    table >> Edge(label="stream (REMOVE / ->Completed)") >> router_fn >> fifo >> cancel_fn
    fifo >> Edge(style="dashed", color="red") >> fifo_dlq
    cancel_fn >> Edge(label="DeleteSchedule") >> scheduler

    # Observability
    for fn in (api_fn, expire_fn, router_fn, cancel_fn, post_auth):
        fn >> Edge(style="dotted", color="darkgreen") >> cw
