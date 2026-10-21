# Configure Tali Guard Endpoints for Veritas

Veritas needs an Endpoint callback URL, its protocol type, and an Endpoint credential. The configuration below is performed in Tali Guard; Veritas does not create or publish Guard resources.

## Configure a reproducible smoke Guardrail

This example verifies request transport, response checks, blocking, redaction, scoring, and reports with deterministic rules.

1. Open **Guardrails** and create a Guardrail named `Veritas Endpoint Smoke`.
2. Add **Phrase filters** with these entries, enabled for **input and output**:

   | Phrase | Action | Replacement |
   |---|---|---|
   | `[BLOCK]` | Block | N/A |
   | `person@example.test` | Transform | `[EMAIL]` |

3. Run the Guard's required rule acceptance checks, publish the version, and select **Enforce** protection mode. Use full-buffered output for this synchronous example.

The equivalent create-Guardrail payload is provided in [guardrail-smoke-config.json](../examples/guardrail-smoke-config.json). It uses Tali's existing `configured-phrase-filter` policy and its `phrase_entries` parameter. The payload is a configuration reference for the Guard management API; it is not a runtime scan body or a Guard package import file.

For benchmark efficacy runs, publish a separate version with the actual policies under testing: content safety/jailbreak detection, prompt injection, PII transformation, or topic restrictions. Enable the appropriate direction for every rule. Align the expected actions with the policy; a toxic-text label does not automatically imply that a customer's configured Endpoint must block it.

## Publish and bind the route

1. Open **Integration > Routers** and create a test Router.
2. Configure a fallback route to the published Guardrail version. Assign that version 100% of the target weight for a stable initial testing.
3. Publish the Router through the deployment's normal change-review flow and wait for its active revision to reach the Runner.

The effective execution path is:

```text
Veritas Target connection -> Guard Endpoint runtime URL -> bound published Router -> selected Guardrail version
```

Both protocol Endpoints can bind to this Router. Routing conditions that depend on LiteLLM model names, request data, or conversation context do not receive equivalent fields from F5 Scan. Use a route that matches the intended traffic for each protocol.

## Register one Endpoint for each protocol

Open **Integration > Endpoints** in your Guard console, select the registration action, and create:

| Example name | Endpoint protocol | Veritas `adapter` |
|---|---|---|
| `Veritas LiteLLM` | TaskLattice Guard for LiteLLM | `litellm-generic-guardrail` |
| `Veritas F5` | Scan (F5 compatible) | `f5-scan` |

For each Endpoint:

1. Save the one-time credential shown during registration. If it is no longer available, use the Endpoint's credential-generation action to issue a new one.
2. Bind the published testing Router from the Router's Endpoints view. Confirm that the Endpoint detail shows the expected bound Router.
3. Enable **Accept callbacks** and wait for configuration synchronization.
4. Open its setup instructions and copy the full runtime callback URL. Replace the placeholder ID in the matching Veritas Target file with this Endpoint's ID.

For the F5 Endpoint, the default `flagOnly` setting may be true. Veritas always sends `flagOnly: false` explicitly so the response distinguishes `blocked` from `redacted`; an Endpoint default does not override an explicit request value. You can set the Endpoint default to false if manual scan clients should use the same behavior.

## Configure local Targets and credentials

Copy the examples into the ignored local data directory:

```sh
mkdir -p data/targets
cp examples/tali.target.json data/targets/litellm.json
cp examples/f5.target.json data/targets/f5.json
```

Fill in their runtime URLs and use `VERITAS_LITELLM_API_KEY` and `VERITAS_F5_API_KEY` as the respective `apiKeyEnv` values. Export the corresponding credential variables in the same terminal that runs Veritas. The variable name is configurable; Guard's setup page may suggest a different SDK-specific name. Veritas requires the variable referenced by its Target file.

Only credential environment-variable names are stored in Target files and Run snapshots. Inline `apiKey` and custom `headers` configuration are rejected. Veritas does not automatically load `.env` files. Each Endpoint needs its own valid credential even when both share a Router.

Use the runtime origin advertised by your deployment. The examples use the reserved placeholder `https://guard.example.test`; replace it with the runtime origin advertised by your deployment. A console management origin must not be substituted for the scan API.

## Verify one request and one response

The following manual requests use the same protocol and credentials as Veritas. Set `LITELLM_ENDPOINT_ID` and `F5_ENDPOINT_ID` to the two registered IDs.

```sh
# A direct input check using LiteLLM.
curl --fail-with-body --silent --show-error \
  "https://guard.example.test/runtime/v1/endpoints/$LITELLM_ENDPOINT_ID/beta/litellm_basic_guardrail_api" \
  -H "x-api-key: $VERITAS_LITELLM_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"input_type":"request","texts":["[BLOCK] input fixture"],"structured_messages":[]}'

# A standalone saved-response check using LiteLLM; omit litellm_call_id.
curl --fail-with-body --silent --show-error \
  "https://guard.example.test/runtime/v1/endpoints/$LITELLM_ENDPOINT_ID/beta/litellm_basic_guardrail_api" \
  -H "x-api-key: $VERITAS_LITELLM_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"input_type":"response","texts":["Contact person@example.test."],"structured_messages":[]}'

# F5 response scan: input contains the saved model response.
curl --fail-with-body --silent --show-error \
  "https://guard.example.test/runtime/v1/endpoints/$F5_ENDPOINT_ID/backend/v1/scans" \
  -H "Authorization: Bearer $VERITAS_F5_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"input":"Contact person@example.test.","scanDirection":"response","flagOnly":false,"verbose":true}'
```

With the smoke Guardrail, the first returns `BLOCKED`, the second returns `GUARDRAIL_INTERVENED`, and the third returns `result.outcome=redacted` with the original address replaced. For F5 input scanning, change `scanDirection` to `request`; transformed input is returned in `redactedInput`. These manual responses are expected results under the described configuration, not claims that those resources already exist in your deployment.

Next run [the README Target smoke example](../README.md#test-a-real-target). Its six cases verify both directions and all three actions. The CLI's `report` command reads the saved report without sending more requests.

## Diagnose a failed run

| Symptom | Check |
|---|---|
| Connection failure or HTTP 404 | Runtime origin, full callback path, published ingress, and correct Endpoint ID |
| HTTP 401 | Credential belongs to this Endpoint, is active, and is exported under the Endpoint's `apiKeyEnv` |
| Adapter mismatch / HTTP 403 | Endpoint protocol matches the Endpoint's `adapter` and callback path |
| No Router matches / HTTP 503 | A published Router is bound, its route matches this protocol, and its version is ready on the Runner |
| F5 returns `flagged` | Verify explicit `flagOnly: false` reaches the service; Veritas treats ambiguous flagged results as errors |
| Everything is allowed | Confirm Enforce mode, selected Guardrail version, enabled directions, and the actual rule configuration |
| Paired output is skipped | Input was blocked, so no output request was sent |
| LiteLLM paired context failure | Verify the two calls can access the same Runner context; use a deliberate standalone Endpoint when appropriate |
| Run exits 1 with completed checks | Inspect `gate.json`: quality thresholds failed, even though transport and scoring completed |

F5 checks are independent single-text scans. The current Tali implementation ignores `requestPromptId` and does not associate scans with earlier prompts. Use LiteLLM when the testing requires prompt/history context, and confirm the chosen dataset actually provides that context.
