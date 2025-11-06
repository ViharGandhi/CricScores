// telegram-group-listener.js
// Logs in, connects, and processes messages from one Telegram group/channel using Gemini AI

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram";
import input from "input";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { type } from "os";
import dotenv from "dotenv";

dotenv.config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const sessionFile = "./session.txt";

// For private channels without names, we'll find it by listing all channels
// Set this to true for first run to see all your channels and get the ID
const LIST_ALL_CHANNELS = false
// Once you know the channel ID, set it here and change LIST_ALL_CHANNELS to false
const TARGET_CHANNEL_ID = 1736810240; // Will be set after first run

const scorecard = {
  runs: 164,
  over: 19.4,
  wicket: 8,
  onstrike: 0
};

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY
});

const systemPrompt = `You are a structured data extractor for live cricket commentary messages.
You will receive raw Telegram messages containing cricket score updates.
Your goal is to extract meaningful scoring or wicket events, extras, or free hits.`;

// ============================================================================
// GEMINI PROCESSING FUNCTION
// ============================================================================

async function processWithGemini(message) {
  const fullPrompt = `${systemPrompt}

Analyze the following message from a cricket Telegram group.
Extract structured information about the event in the following JSON format:

{
  "type": "RUNS | DOT | FOUR | SIX | WICKET | EXTRA | FREE_HIT",
  "runs_off_bat": <number>,
  "extra_type": "wide | no_ball | leg_bye | bye | null",
  "extra_runs": <number>,
  "free_hit": <true/false>,
  "wicket": <true/false>,
  "ignore": <true/false>
}

Rules:
- If the message doesn't represent a scoring event, set "ignore": true.
- If a "NO BALL" or "WIDE" has a number like "+3", that means extra_runs = 3.
- If it mentions "FREE HIT", set "free_hit": true.
- If it's a normal scoring ball (like 2), leave extra_type = null.
- Do not calculate totals. Just identify and classify.
- If both a scoring shot and an extra are present, treat them separately — you only describe what's visible in this message.
- Also after every boundary there will be a message of boundary and then an appreciation of the boundary like for example "SIXX!!! WOW NICELY PLAYED THIS BALL 👌" or similarly for 4 so keep in mind to ignore this message as accounting for this is already done.
- Also any message that gives the player on strike or things like full score card or required run rate or other than what we have described needs to be ignored.
- see as per cricket rules you know which extras count run incremented by one like in wide or no ball so now keep in mind to add that in our  extra_runs as well so if no ball + 3 so extra runs 4 or else if wide + 3 so extra runs 4 get it 
- if there is a no ball or wide ball always prirotize this as extra_type if it is (meaning like if no ball + leg bye extra type will always be no ball)
- also a little for any no ball and more runs from it will be assumed to be coming from bat and hence we update runs_off_bat ok so if no ball + 3 will be 3 in runs_off_bat and 1 in extra 
- wicket will be only if it there is a word wicket or anything like wkt or wicket or any context to it dont assume it ok 
- if players name appear with emoji ignore them 
Example:
Input: "NO BALL ☄️ +3 🏏 FREE HIT "
Output:
{
  "type": "EXTRA",
  "runs_off_bat": 3,
  "extra_type": "no_ball",
  "extra_runs": 1,
  "free_hit": true,
  "wicket": false,
  "ignore": false
}

Message:
"${message}"

Please respond with ONLY the JSON object, no additional text.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
    });

    return response.text;
  } catch (error) {
    console.error("❌ Error processing with Gemini:", error.message);
    return null;
  }
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

const savedSession = fs.existsSync(sessionFile)
  ? fs.readFileSync(sessionFile, "utf8").trim()
  : "";
const stringSession = new StringSession(savedSession);

// ============================================================================
// MAIN EXECUTION
// ============================================================================

(async () => {
  console.log("Starting Telegram client...");
  
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  // Login flow (first time only)
  if (!savedSession) {
    console.log("No saved session found — starting login process...");
    await client.start({
      phoneNumber: async () => await input.text("Enter your phone number (with +countrycode): "),
      password: async () => await input.text("Enter your 2FA password (press Enter if none): "),
      phoneCode: async () => await input.text("Enter the login code you received: "),
      onError: (err) => console.log(err),
    });
    console.log("Login successful!");
    const session = client.session.save();
    fs.writeFileSync(sessionFile, session);
    console.log("Session saved to session.txt — you won't need to log in again.");
  } else {
    await client.connect();
    console.log("✅ Connected using saved session.");
  }

  // Get all dialogs (chats/channels you're part of)
  console.log("Fetching your channels...");
  const dialogs = await client.getDialogs({ limit: 100 });
  
  let target = null;
  
  if (LIST_ALL_CHANNELS || !TARGET_CHANNEL_ID) {
    console.log("\n📋 All your channels:");
    console.log("════════════════════════════════════════════════════════");
    
    for (const dialog of dialogs) {
      if (dialog.isChannel) {
        const entity = dialog.entity;
        const channelId = entity.id.toString();
        const title = entity.title || "(No Title - Private Channel)";
        const username = entity.username ? `@${entity.username}` : "(No username)";
        
        console.log(`\nTitle: ${title}`);
        console.log(`Username: ${username}`);
        console.log(`Channel ID: ${channelId}`);
        console.log(`Access Hash: ${entity.accessHash?.toString()}`);
        console.log("────────────────────────────────────────────────────────");
      }
    }
    
    console.log("\n⚠️  SETUP REQUIRED:");
    console.log("1. Find your cricket channel from the list above");
    console.log("2. Copy its Channel ID");
    console.log("3. Set TARGET_CHANNEL_ID in the code to that ID (as a string)");
    console.log("4. Change LIST_ALL_CHANNELS to false");
    console.log("5. Run the script again\n");
    
    process.exit(0);
  }
  
  // Find the target channel by ID
  target = dialogs.find(d => 
    d.isChannel && d.entity.id.toString() === TARGET_CHANNEL_ID.toString()
  )?.entity;
  
  if (!target) {
    console.error("❌ Could not find channel with ID:", TARGET_CHANNEL_ID);
    console.error("Make sure you've joined the channel and the ID is correct.");
    process.exit(1);
  }
  
  const targetTitle = target.title || "(Private Channel)";
  console.log(`✅ Listening to: ${targetTitle}`);
  console.log(`   Channel ID: ${target.id}`);

  // ============================================================================
  // EVENT HANDLER - Listen for new messages
  // ============================================================================

  client.addEventHandler(async (update) => {
    if (!update.message || !update.message.message) return;

    const msg = update.message;
    const peer = msg.peerId;
    const peerChannelId = peer?.channelId?.valueOf?.();
    const peerChatId = peer?.chatId?.valueOf?.();
    const peerUserId = peer?.userId?.valueOf?.();
    const targetId = target.id?.valueOf?.();

    // Only process if message belongs to the target entity
    if (peerChannelId === targetId || peerChatId === targetId || peerUserId === targetId) {
      console.log("📩 New message from target channel:");
      console.log(msg.message);
      console.log("----------------------");

      // Process with Gemini
      console.log("🤖 Processing with Gemini AI...");
      let seconds = Date.now();   
      const geminiOutput = await processWithGemini(msg.message);
      let after = Date.now();
      console.log(`⏱️  Processing time: ${after-seconds}ms`);

      if (geminiOutput) {
        console.log("✅ Gemini Analysis:");
        console.log(geminiOutput);

        // Parse JSON and update scorecard
        try {
          // Parse the JSON output from Gemini
          const data = typeof geminiOutput === 'string'
            ? JSON.parse(geminiOutput.replace(/```json\n?/g, '').replace(/```\n?/g, ''))
            : geminiOutput;

          // If message should be ignored, don't update
          if (data.ignore) {
            console.log("⏭️  Message ignored, no scorecard update");
            console.log(scorecard);
            return;
          }

          // Update wickets
          if (data.wicket == true) {
            scorecard.wicket += 1;
            scorecard.wicket = scorecard.wicket % 11;
          }

          // Update runs and handle strike rotation
          let last_scorecard = scorecard.runs;
          scorecard.runs += data.runs_off_bat + data.extra_runs;
          let rotationRuns = scorecard.runs;
          
          // -1 because the run that came from the wide and no ball is not counted 
          if (data.extra_type == "wide" || data.extra_type == "no_ball") {
            rotationRuns -= 1;
          }
          
          // Simple direct logic: if runs are odd the striker changes
          // Also handle edge case: no strike rotation for dot ball
          if ((rotationRuns - last_scorecard) % 2 != 0 && rotationRuns - last_scorecard != 0) {
            scorecard.onstrike = scorecard.onstrike ^ 1;
          }

          // Update overs (only for legal deliveries)
          if (data.extra_type !== "wide" && data.extra_type !== "no_ball") {
            // Increment ball count
            const currentBalls = Math.round((scorecard.over % 1) * 10);
            if (currentBalls === 5) {
              // Complete over
              scorecard.over = Math.floor(scorecard.over) + 1.0;
              scorecard.onstrike = scorecard.onstrike ^ 1; // Strike change on over complete 
            } else {
              // Add one ball
              scorecard.over = Math.floor(scorecard.over) + (currentBalls + 1) / 10;
            }
          }

          console.log("📊 Updated Scorecard:");
          console.log(scorecard);

        } catch (error) {
          console.error("❌ Error updating scorecard:", error.message);
        }
      }
    }
  });

  console.log(`\n🎧 Listening for new messages from channel ID: ${target.id}...`);
  console.log("Press Ctrl+C to stop.\n");
})();