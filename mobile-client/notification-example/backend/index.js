const express = require("express");
const webpush = require("web-push");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3000;

// Generate once with: node generate-vapid.js
const PUBLIC_VAPID_KEY = "YOUR_PUBLIC_VAPID_KEY";
const PRIVATE_VAPID_KEY = "YOUR_PRIVATE_VAPID_KEY";

webpush.setVapidDetails(
  "mailto:you@example.com",
  PUBLIC_VAPID_KEY,
  PRIVATE_VAPID_KEY
);

// In production, store this in a database
let subscriptions = [];

// Browser calls this from index.html
app.post("/subscribe", (req, res) => {
  const subscription = req.body;

  subscriptions.push(subscription);

  res.status(201).json({
    ok: true,
    message: "Subscribed"
  });
});

// Trigger notification manually
app.post("/notify", async (req, res) => {
  const payload = JSON.stringify({
    title: req.body.title || "Hello",
    body: req.body.body || "Notification from Express"
  });

  const results = await Promise.allSettled(
    subscriptions.map(subscription =>
      webpush.sendNotification(subscription, payload, {
        urgency: "high",
        TTL: 30
      })
    )
  );

  res.json({
    ok: true,
    sent: results.filter(r => r.status === "fulfilled").length,
    failed: results.filter(r => r.status === "rejected").length
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});