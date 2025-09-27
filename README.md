# End-to-End Browser to RTMP Broadcasting

Turnkey solution to broadcast RTMP streams directly from the browser using WebRTC.

## Features

- Runs in the cloud (AWS)
- Automatic install of all components
  - VPC, subnet, Internet Gateway, routing etc.
  - Port configuration
  - Subdomain and SSL certificate management
  - Required software
- Live install progress
- Broadcaster UI

## Setup

### Deploying the stack

1. Sign in to the [AWS Management Console](https://aws.amazon.com/console)
2. You will need a domain that you can create new DNS entries for; if this is managed via Route53, create a [Hosted Zone](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingHostedZone.html) for it; othewise you'll have to manually create some A records in the end
3. Click the button below to launch the CloudFormation template. Alternatively you can [download](template.yaml) the template and adjust it to your needs.
   [![Launch Stack](https://cdn.rawgit.com/buildkite/cloudformation-launch-stack-button-svg/master/launch-stack.svg)](https://console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=rtmp-relay&templateURL=https://s3.amazonaws.com/lostshadow/browser-rtmp-relay/template.yaml)
4. Choose a name for your stack or leave the default there
5. Adjust the parameters:
   - `DomainName` - Use a domain name you have access to. The demo will be installed on a subdomain of this domain, named according to the stack name specified above
   - `InstanceType` - Server Instance Type. Larger instances will be able to run more symultaneous streams - for initial testing just choose the 'micro'
6. Acknowledge IAM creation (Lambda + role) and create the stack.
7. When the stack reaches **CREATE_COMPLETE**, look up under **Outputs → `SetupProgressURL`** and click the `http://x.x.x.x:8087` link there
8. The page will keep you informed of the initializations it needs to make. If a DNS records needs created manually, it will let you know about that. When the process completes, a https link to your broadcaster is created. Click that.
9. In the broadcaster page, first hit the `Access Camera and Microphone`
10. Allow Camera and Microphone access as requested by your browser
11. Fill in the `RTMP Broadcast URL` with the RTMP URL you want to broadcast to (as provided by your streaming platform); if the provided RTMP credentials have 2 parts (i.e. `Server` & `Stream Key`), join them together into a single stream, separated by a `/` (forward slash) character.
12. Hit `Start broadcast`

## Costs

Typical AWS charges apply for:

- EC2 instance (size you choose)
- Elastic IP
- Minimal Lambda invocations / CloudWatch Logs

Delete the stack when done to stop charges.

---

## Troubleshooting

- **Progress page stuck on DNS**
  - If you’re using an external DNS provider, make sure **exactly** `A: <StackName>.<DomainName> → <EIP>` exists.
  - Public resolvers may cache responses briefly; give it a few minutes and refresh the progress page.
- **Certbot failed**
  - Almost always DNS propagation. Verify the A record resolves to your EIP (e.g., `dig <stack>.<domain> A @1.1.1.1`), then re-create the stack or rerun Certbot (if you enabled access).
- **No SSH access**
  - The instance launches **without** a key. Add **SSM Session Manager** or add a `KeyName` to the instance if you want shell.
- **Ports / firewall**
  - If media doesn’t flow, confirm your client can reach **UDP 10000–10004** and **TCP 3478/8443**.

---

## Customize

- **Harden access**: remove SSH 22/TCP or restrict CIDR; add **SSM**; attach a key pair.
- **Change ports**: edit the **SecurityGroup** rules.
- **Different regions**: extend the AMI mapping.
- **Different UI path**: update the `FINAL_URL` section in UserData.

---

## Cleanup

- **CloudFormation → Delete** the stack.
- If you manually added an **A record** at an external DNS provider, remove it there too.
