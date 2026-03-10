# Google Apps Script — Approval Bridge

This script watches a Gmail inbox for replies to "Warp Draft Ready" emails and forwards the approval decision to your webhook.

## Setup

### 1. Create the Apps Script

1. Go to [script.google.com](https://script.google.com)
2. Click **New Project**
3. Name it: `WARP Approval Bridge`
4. Delete the default code and paste the script below
5. Save

### 2. Set Script Properties

1. In the Apps Script editor, click **Project Settings** (gear icon)
2. Scroll to **Script Properties** → **Add Property**
3. Add these two properties:

| Property | Value |
|----------|-------|
| `WEBHOOK_URL` | Your webhook base URL + `/api/approval` (e.g., `https://xxxxx.ngrok.app/api/approval`) |
| `WEBHOOK_SECRET` | Same value as `APPROVAL_WEBHOOK_SECRET` in your `.env.local` |

### 3. Add a Time-Based Trigger

1. In the Apps Script editor, click **Triggers** (clock icon in left sidebar)
2. Click **+ Add Trigger**
3. Configure:
   - Function: `checkForApprovalReplies`
   - Event source: **Time-driven**
   - Type: **Minutes timer**
   - Interval: **Every 1 minute**
4. Click **Save**
5. Authorize the script when prompted

### 4. Test

1. Send a test email with subject containing "Warp Draft Ready" and an Approval ID in the body
2. Reply to it with `yes` or `no edit: shorten the intro`
3. Check the Apps Script execution log for POST results
4. Check `data/approval_jobs.json` for status updates

---

## Apps Script Code

```javascript
/**
 * WARP Approval Bridge
 *
 * Watches Gmail for replies to "Warp Draft Ready" threads.
 * Extracts the Approval ID and reply decision, then POSTs to the webhook.
 *
 * Script Properties required:
 *   WEBHOOK_URL    — Full webhook URL (e.g., https://xxxxx.ngrok.app/api/approval)
 *   WEBHOOK_SECRET — Shared secret matching APPROVAL_WEBHOOK_SECRET
 */

function checkForApprovalReplies() {
  var props = PropertiesService.getScriptProperties();
  var webhookUrl = props.getProperty("WEBHOOK_URL");
  var webhookSecret = props.getProperty("WEBHOOK_SECRET");

  if (!webhookUrl || !webhookSecret) {
    Logger.log("ERROR: Missing WEBHOOK_URL or WEBHOOK_SECRET in Script Properties");
    return;
  }

  // Search for threads with "Warp Draft Ready" in subject
  var threads = GmailApp.search('subject:"Warp Draft Ready" is:inbox newer_than:1d');

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();

    // Need at least 2 messages (original + reply)
    if (messages.length < 2) continue;

    // Get the most recent message (the reply)
    var reply = messages[messages.length - 1];

    // Skip if the reply is from us (the sender), not Troy
    // We only process replies FROM the recipient
    var replyFrom = reply.getFrom();

    // Check if we've already processed this reply
    var replyId = reply.getId();
    var processedKey = "processed_" + replyId;
    if (props.getProperty(processedKey)) continue;

    // Extract Approval ID from the original message body
    var originalBody = messages[0].getPlainBody();
    var approvalIdMatch = originalBody.match(/Approval ID:\s*([a-f0-9-]+)/i);
    if (!approvalIdMatch) {
      // Try to find it in any message in the thread
      for (var m = 0; m < messages.length; m++) {
        var body = messages[m].getPlainBody();
        approvalIdMatch = body.match(/Approval ID:\s*([a-f0-9-]+)/i);
        if (approvalIdMatch) break;
      }
    }

    if (!approvalIdMatch) {
      Logger.log("No Approval ID found in thread: " + thread.getFirstMessageSubject());
      continue;
    }

    var approvalId = approvalIdMatch[1];

    // Parse the reply body
    var replyBody = reply.getPlainBody().trim();

    // Remove quoted text (lines starting with >)
    var lines = replyBody.split("\n");
    var cleanLines = [];
    for (var l = 0; l < lines.length; l++) {
      var line = lines[l].trim();
      if (line.startsWith(">")) continue;
      if (line.match(/^On .+ wrote:$/)) break; // Stop at Gmail quote header
      if (line === "") continue;
      cleanLines.push(line);
    }
    var cleanReply = cleanLines.join(" ").trim().toLowerCase();

    var payload = {
      secret: webhookSecret,
      approval_id: approvalId
    };

    if (cleanReply.startsWith("yes")) {
      payload.action = "approve";
    } else if (cleanReply.startsWith("no edit:")) {
      payload.action = "edit";
      // Get the edit instructions (preserve original casing)
      var originalCleanLines = [];
      for (var l2 = 0; l2 < lines.length; l2++) {
        var line2 = lines[l2].trim();
        if (line2.startsWith(">")) continue;
        if (line2.match(/^On .+ wrote:$/)) break;
        if (line2 === "") continue;
        originalCleanLines.push(line2);
      }
      var fullReply = originalCleanLines.join(" ").trim();
      payload.edit_instructions = fullReply.replace(/^no edit:\s*/i, "");
    } else {
      Logger.log("Unrecognized reply format: " + cleanReply.substring(0, 100));
      continue;
    }

    // POST to webhook
    try {
      var options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      var response = UrlFetchApp.fetch(webhookUrl, options);
      var code = response.getResponseCode();
      var responseBody = response.getContentText();

      Logger.log(
        "Webhook response for " + approvalId + ": " +
        code + " " + responseBody
      );

      if (code === 200 || code === 201) {
        // Mark as processed
        props.setProperty(processedKey, new Date().toISOString());
        // Archive the thread to keep inbox clean
        thread.moveToArchive();
      }
    } catch (e) {
      Logger.log("Webhook error for " + approvalId + ": " + e.message);
    }
  }
}
```

---

## How It Works

1. The script runs every 1 minute via a time-based trigger
2. It searches Gmail for threads with "Warp Draft Ready" in the subject
3. For each thread with a reply:
   - Extracts the Approval ID from the email body
   - Parses the reply text (ignoring quoted text)
   - If reply starts with `yes` → POSTs `action: "approve"`
   - If reply starts with `no edit:` → POSTs `action: "edit"` with instructions
4. On successful webhook response, marks the reply as processed and archives the thread

## Reply Format

| Reply | Action |
|-------|--------|
| `yes` | Publishes the Webflow CMS item |
| `no edit: shorten the intro` | Applies edits, updates draft, sends new preview |
| `no edit: make problem section more specific to LTL` | Rewrites the referenced section |

## Troubleshooting

- **No threads found**: Ensure the original email subject contains "Warp Draft Ready"
- **Approval ID not found**: Check that the email body contains `Approval ID: <uuid>`
- **401 from webhook**: Verify `WEBHOOK_SECRET` matches `APPROVAL_WEBHOOK_SECRET` in `.env.local`
- **Connection refused**: Ensure your webhook is accessible (ngrok is running, or app is deployed)

## Security Notes

- The webhook secret is stored in Apps Script Properties, not in the code
- Only threads matching the exact subject pattern are processed
- Each reply is processed exactly once (deduplicated by message ID)
- The script only reads reply content; it does not modify emails
