const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadDB, saveDB, getMode, createId, DATA_DIR } = require("./db");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Online service keys (set via environment variables when deployed)
const GNEWS_API_KEY = process.env.GNEWS_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";


// ======================
// MIDDLEWARE
// ======================
app.use(cors());
app.use(express.json({ limit: "40mb" }));
app.use(express.static(__dirname));

// Media directories
const AVATAR_DIR = path.join(__dirname, "uploads", "avatars");
const POST_IMAGE_DIR = path.join(__dirname, "uploads", "posts");
const POST_VIDEO_DIR = path.join(__dirname, "uploads", "videos");
[AVATAR_DIR, POST_IMAGE_DIR, POST_VIDEO_DIR].forEach(d => {
  try {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  } catch (e) {
    console.warn("Could not create media dir", d, e.message);
  }
});


// ======================
// DATABASE (SQLite when available, else atomic JSON)
// ======================
// loadDB, saveDB, createId imported from ./db.js

function hashPassword(password) {
  return crypto.createHash("sha256").update(password + "GLOBAL_SALT_2026").digest("hex");
}

// ======================
// ROOT & STATUS
// ======================
app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


app.get("/health", async (req, res) => {
  res.status(200).json({ ok: true, status: "healthy" });
});

app.get("/api/status", async (req, res) => {
  const db = await loadDB();
  res.json({
    name: "GLOBAL Organisation API",
    status: "online",
    version: "4.1-online",
    message: "Online multi-user backend is running.",
    services: {
      ai: ANTHROPIC_API_KEY ? "anthropic" : "local-fallback",
      news: GNEWS_API_KEY ? "gnews" : "local-fallback",
      payments: PAYSTACK_SECRET_KEY ? "paystack" : "disabled",
      research: "openalex",
      database: getMode()
    },
    stats: {
      users: db.users.length,
      opportunities: db.opportunities.length,
      ideas: db.ideas.length,
      problems: db.problems.length,
      projects: db.projects.length,
      messages: db.messages.length,
      teams: db.teams.length,
      posts: db.posts.length,
      mentors: db.users.filter(u => u.isMentor).length,
      mentorships: db.mentorships.length
    }
  });
});

// ======================
// AUTH / USERS
// ======================
app.post("/api/register", async (req, res) => {
  try {
    const { fullName, username, email, password } = req.body;

    if (!fullName || !username || !email || !password) {
      return res.status(400).json({ success: false, error: "All fields are required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: "Password must be at least 8 characters." });
    }

    const cleanUsername = String(username).trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9._]/g, "");
    const cleanEmail = String(email).trim().toLowerCase();

    if (cleanUsername.length < 3) {
      return res.status(400).json({ success: false, error: "Username must be at least 3 characters." });
    }

    const db = await loadDB();

    if (db.users.some(u => u.username === cleanUsername)) {
      return res.status(409).json({ success: false, error: "Username already taken." });
    }
    if (db.users.some(u => u.email === cleanEmail)) {
      return res.status(409).json({ success: false, error: "Email already registered." });
    }

    const newUser = {
      userId: createId("GLOBAL"),
      fullName: fullName.trim(),
      username: cleanUsername,
      email: cleanEmail,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      lastLogin: null,
      bio: "",
      location: "",
      website: "",
      avatar: null
    };

    db.users.push(newUser);
    await saveDB(db);

    const { passwordHash, ...safeUser } = newUser;
    res.status(201).json({ success: true, message: "Account created successfully.", user: safeUser });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ success: false, error: "Registration failed." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: "Email/username and password are required." });
    }

    const db = await loadDB();
    const cleanId = String(identifier).trim().toLowerCase().replace(/^@/, "");

    const user = db.users.find(u =>
      String(u.email || "").toLowerCase() === cleanId ||
      String(u.username || "").toLowerCase() === cleanId
    );
    if (!user) {
      return res.status(401).json({ success: false, error: "Account not found." });
    }
    if (user.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ success: false, error: "Incorrect password." });
    }

    user.lastLogin = new Date().toISOString();
    await saveDB(db);

    const { passwordHash, ...safeUser } = user;
    res.json({ success: true, message: "Login successful.", user: safeUser });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, error: "Login failed." });
  }
});

app.get("/api/user/:userId", async (req, res) => {
  const db = await loadDB();
  const user = db.users.find(u => u.userId === req.params.userId);
  if (!user) return res.status(404).json({ success: false, error: "User not found." });
  const { passwordHash, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

app.get("/api/users", async (req, res) => {
  const db = await loadDB();
  const safeUsers = db.users.map(({ passwordHash, ...u }) => u);
  res.json({ success: true, users: safeUsers, count: safeUsers.length });
});

// Update profile — covers every field the Profile page uses. Stored
// directly on the user record so there's one source of truth per user
// instead of a separate local-only "profile" object.
app.put("/api/user/:userId", async (req, res) => {
  try {
    const db = await loadDB();
    const user = db.users.find(u => u.userId === req.params.userId);
    if (!user) return res.status(404).json({ success: false, error: "User not found." });

    const {
      fullName, username, email, country, language,
      dateOfBirth, location, about, goals, skills, education, experience,
      bio, website, isMentor, mentorTopics, mentorHeadline
    } = req.body;

    if (username !== undefined) {
      const cleanUsername = String(username).trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9._]/g, "");
      if (cleanUsername.length < 3) {
        return res.status(400).json({ success: false, error: "Username must be at least 3 characters." });
      }
      if (db.users.some(u => u.username === cleanUsername && u.userId !== user.userId)) {
        return res.status(409).json({ success: false, error: "Username already taken." });
      }
      user.username = cleanUsername;
    }

    if (email !== undefined) {
      const cleanEmail = String(email).trim().toLowerCase();
      if (db.users.some(u => u.email === cleanEmail && u.userId !== user.userId)) {
        return res.status(409).json({ success: false, error: "Email already registered." });
      }
      user.email = cleanEmail;
    }

    if (fullName) user.fullName = String(fullName).trim();
    if (country !== undefined) user.country = String(country).trim().slice(0, 100);
    if (language !== undefined) user.language = String(language).trim().slice(0, 50);
    if (dateOfBirth !== undefined) user.dateOfBirth = String(dateOfBirth).trim().slice(0, 20);
    if (location !== undefined) user.location = String(location).trim().slice(0, 100);
    if (about !== undefined) user.about = String(about).trim().slice(0, 1000);
    if (goals !== undefined) user.goals = String(goals).trim().slice(0, 1000);
    if (skills !== undefined) user.skills = String(skills).trim().slice(0, 500);
    if (education !== undefined) user.education = String(education).trim().slice(0, 1000);
    if (experience !== undefined) user.experience = String(experience).trim().slice(0, 1000);
    if (bio !== undefined) user.bio = String(bio).trim().slice(0, 500);
    if (website !== undefined) user.website = String(website).trim().slice(0, 200);
    if (isMentor !== undefined) user.isMentor = Boolean(isMentor);
    if (mentorTopics !== undefined) user.mentorTopics = String(mentorTopics).trim().slice(0, 300);
    if (mentorHeadline !== undefined) user.mentorHeadline = String(mentorHeadline).trim().slice(0, 140);

    await saveDB(db);
    const { passwordHash, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ success: false, error: "Could not update profile." });
  }
});

// Upload / change profile picture
// Client sends a base64 data URL (e.g. "data:image/png;base64,...."),
// this saves it as a real file in /uploads/avatars and stores just the
// file path on the user record — the database itself never holds the image.
app.post("/api/user/:userId/avatar", async (req, res) => {
  try {
    const db = await loadDB();
    const user = db.users.find(u => u.userId === req.params.userId);
    if (!user) return res.status(404).json({ success: false, error: "User not found." });

    const { imageBase64 } = req.body;
    if (!imageBase64 || !imageBase64.startsWith("data:image/")) {
      return res.status(400).json({ success: false, error: "A valid image is required." });
    }

    const match = imageBase64.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ success: false, error: "Unsupported image format. Use PNG, JPG, GIF, or WEBP." });
    }

    const ext = match[1] === "jpeg" ? "jpg" : match[1];
    const buffer = Buffer.from(match[2], "base64");

    // 5MB cap so one picture can't fill up the disk
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: "Image is too large (5MB max)." });
    }

    // Remove any older avatar file for this user before saving the new one
    ["png", "jpg", "gif", "webp"].forEach(e => {
      const oldFile = path.join(AVATAR_DIR, `${user.userId}.${e}`);
      if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
    });

    const fileName = `${user.userId}.${ext}`;
    fs.writeFileSync(path.join(AVATAR_DIR, fileName), buffer);

    // Cache-bust so browsers show the new picture right away
    user.avatar = `/uploads/avatars/${fileName}?v=${Date.now()}`;
    await saveDB(db);

    const { passwordHash, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error("Avatar upload error:", err);
    res.status(500).json({ success: false, error: "Could not upload profile picture." });
  }
});

// Remove profile picture (deletes the file, clears the reference)
app.delete("/api/user/:userId/avatar", async (req, res) => {
  try {
    const db = await loadDB();
    const user = db.users.find(u => u.userId === req.params.userId);
    if (!user) return res.status(404).json({ success: false, error: "User not found." });

    ["png", "jpg", "gif", "webp"].forEach(e => {
      const file = path.join(AVATAR_DIR, `${user.userId}.${e}`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    user.avatar = null;
    await saveDB(db);

    const { passwordHash, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not remove profile picture." });
  }
});

// ======================
// INNOVATION FEED (GLOBAL News + Innovation intelligence system)
// Base item only — Layman's Terms, Horizon, and Evidence Score
// are separate bricks layered on top of this later.
// ======================
app.get("/api/innovation-items", async (req, res) => {
  const db = await loadDB();
  const items = (db.innovationItems || [])
    .map(item => ({ kind: item.kind || "innovation", location: item.location || null, skills: item.skills || null, result: item.result || null, ...item }))
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, items });
});

app.post("/api/innovation-items", async (req, res) => {
  try {
    const { title, summary, sourceUrl, category, submittedBy } = req.body;
    if (!title || !summary) {
      return res.status(400).json({ success: false, error: "Title and summary are required." });
    }

    const db = await loadDB();
    const newItem = {
      id: createId("INNOV"),
      kind: String(req.body.kind || "innovation"),
      location: req.body.location ? String(req.body.location).trim().slice(0,160) : null,
      skills: req.body.skills ? String(req.body.skills).trim().slice(0,500) : null,
      result: req.body.result ? String(req.body.result).trim().slice(0,120) : null,
      title: title.trim(),
      summary: summary.trim(),
      sourceUrl: sourceUrl || null,
      category: category || "General",
      submittedBy: submittedBy || null,
      createdAt: new Date().toISOString()
    };

    db.innovationItems.unshift(newItem);
    await saveDB(db);
    res.status(201).json({ success: true, item: newItem });
  } catch (err) {
    console.error("Create innovation item error:", err);
    res.status(500).json({ success: false, error: "Could not create innovation item." });
  }
});

// (API keys defined at top of file)

// What featuring a listing costs. Prices are decided here, server-side —
// never trust a price sent from the browser, or anyone could pay ₦1 to
// feature a listing for a year.
const FEATURE_PRICING = {
  7: 5000,    // 7 days  — ₦5,000
  30: 15000   // 30 days — ₦15,000
};

// ======================
// NEWS (GNews proxy)
// ======================
app.get("/api/news", async (req, res) => {
  try {
    const {
      mode = "headlines",
      q = "",
      category = "general",
      country = "ng",
      page = "1",
      max = "10"
    } = req.query;

    // Online GNews when key is present
    if (GNEWS_API_KEY) {
      let url;
      if (mode === "search") {
        if (!q.trim()) {
          return res.status(400).json({ success: false, error: "Search query is required." });
        }
        url =
          "https://gnews.io/api/v4/search" +
          "?q=" + encodeURIComponent(q) +
          "&lang=en" +
          "&max=" + encodeURIComponent(max) +
          "&page=" + encodeURIComponent(page) +
          "&sortby=publishedAt" +
          "&apikey=" + GNEWS_API_KEY;
      } else {
        url =
          "https://gnews.io/api/v4/top-headlines" +
          "?category=" + encodeURIComponent(category) +
          "&lang=en" +
          "&max=" + encodeURIComponent(max) +
          "&page=" + encodeURIComponent(page) +
          "&apikey=" + GNEWS_API_KEY;
        if (country) {
          url += "&country=" + encodeURIComponent(country);
        }
      }

      const response = await fetch(url);
      const data = await response.json();
      if (response.ok) {
        return res.json({ success: true, articles: data.articles || [], source: "gnews" });
      }
      console.error("GNews error:", data);
    }

    // Fallback: platform activity as news (always works online or offline)
    const db = await loadDB();
    const articles = [
      {
        title: "GLOBAL Organisation — problem to project flow is live",
        description: "Report problems, share ideas, form teams and start projects in one place.",
        content: "From Nigeria, building solutions for Africa and the world.",
        url: "/",
        image: null,
        publishedAt: new Date().toISOString(),
        source: { name: "GLOBAL" }
      }
    ];
    (db.problems || []).slice(0, 5).forEach(p => {
      articles.push({
        title: "Problem: " + p.title,
        description: (p.description || "").slice(0, 180),
        content: p.description || "",
        url: "/problems.html",
        image: null,
        publishedAt: p.createdAt || new Date().toISOString(),
        source: { name: "Problems" }
      });
    });
    res.json({ success: true, articles, source: "local" });
  } catch (err) {
    console.error("News proxy error:", err);
    res.status(500).json({ success: false, error: "Could not fetch news." });
  }
});


// ======================
// LOCAL AI FALLBACK (no external key required)
// Used automatically when ANTHROPIC_API_KEY is not set.
// ======================
function localAIReply(message, db) {
  const t = String(message || "").toLowerCase().trim();
  const problems = (db.problems || []).slice(0, 8);
  const ideas = (db.ideas || []).slice(0, 8);
  const projects = (db.projects || []).slice(0, 6);

  if (/^(hi|hello|hey|good morning|good afternoon)\b/.test(t) || t === "hi" || t === "hello") {
    return "Hello. I am GLOBAL AI (local mode). I can help you explore problems, ideas, projects and opportunities on the platform, and guide you on how to contribute.\n\nWhat would you like to work on?";
  }
  if (/what (is|are) (you|global)|who are you|mission|about global/.test(t)) {
    return "GLOBAL Organisation is building solutions from Nigeria for Africa and the world.\n\nCore flow: Problem → Idea → Team → Project → Impact.\n\nFocus areas include education, power/energy, agriculture, health, technology and employment.\n\nI am currently running in local mode. Add ANTHROPIC_API_KEY on the server for full Claude-powered answers.";
  }
  if (/how (do i|can i|to) (start|contribute|join|help)/.test(t)) {
    return "Fastest way to contribute:\n1. Create an account\n2. Post a real problem or share an idea\n3. Browse Problems → Ideas → Projects\n4. Join a team or start one\n5. Check Opportunities for jobs and grants\n\nEverything is designed around: Problem → Idea → Team → Project → Impact.";
  }
  if (/power|electric|solar|energy|outage/.test(t)) {
    const related = problems.filter(p => /power|electric|energy|school/i.test((p.title||"")+(p.description||"")));
    let extra = related.length ? "\n\nRelated problems on the platform:\n" + related.map(p => "• " + p.title).join("\n") : "";
    return "Reliable electricity is one of the highest-leverage problems in Nigeria. Schools, clinics and small businesses lose productive hours every week. Practical approaches include modular solar + battery systems and training local technicians." + extra;
  }
  if (/agricultur|farm|tomato|harvest|crop/.test(t)) {
    return "Agriculture is central to Nigerian livelihoods. High post-harvest losses (especially tomatoes) are a major solvable problem. Low-cost cooling, better packaging and market matching can create real impact. Check the Problems and Ideas sections for related work.";
  }
  if (/educat|school|learn|student/.test(t)) {
    return "Education challenges include unreliable power in schools and limited high-quality content in Yoruba, Hausa and Igbo. GLOBAL can host problems, ideas for local-language tools, and projects that ship real content or infrastructure.";
  }
  if (/problem/.test(t) && problems.length) {
    return "Here are some current problems on GLOBAL:\n" + problems.slice(0,5).map(p => "• " + p.title).join("\n") + "\n\nOpen the Problems page to explore or add your own.";
  }
  if (/idea/.test(t) && ideas.length) {
    return "Recent ideas on the platform:\n" + ideas.slice(0,5).map(i => "• " + i.title).join("\n") + "\n\nShare your own on the Ideas page.";
  }
  if (/project/.test(t) && projects.length) {
    return "Active projects:\n" + projects.map(p => "• " + p.title).join("\n") + "\n\nYou can start or join projects from the Projects page.";
  }
  if (/help|what can you do/.test(t)) {
    return "I can help with:\n• Explaining GLOBAL and the mission\n• Finding problems, ideas and projects on the platform\n• Guidance on energy, agriculture and education in Nigeria\n• How to contribute\n\nFor richer answers, set ANTHROPIC_API_KEY on the server to connect full Claude-powered GLOBAL AI.";
  }
  return "I am running in local mode right now.\n\nI can search the platform for problems, ideas and projects, explain the GLOBAL mission, and give guidance on Nigerian focus areas (power, education, agriculture).\n\nTry: \"show me problems about electricity\" or \"how do I start contributing?\"\n\nTo enable full online GLOBAL AI, add ANTHROPIC_API_KEY to the server environment.";
}


// ======================
// GLOBAL AI (Claude-powered chat)
// ======================
// Each user's conversation is stored under their userId, so it picks up
// where they left off next time — this is real, persistent memory of
// their own chat history. It does not retrain or change the underlying
// Claude model itself; that's not something the API supports.
const AI_SYSTEM_PROMPT =
  "You are GLOBAL AI, the assistant inside GLOBAL Organisation — a Nigerian " +
  "technology and innovation platform for ideas, problems, research, projects, " +
  "teams and opportunities. Be genuinely useful: help people think through " +
  "problems, sharpen ideas, find relevant sections of GLOBAL, and connect their " +
  "goals to real next steps. Keep answers clear and concise.";

// Keep only the most recent messages per user so requests stay small
// and cheap as conversations grow.
const AI_HISTORY_LIMIT = 20;

app.get("/api/ai/history/:userId", async (req, res) => {
  const db = await loadDB();
  const history = (db.aiChats && db.aiChats[req.params.userId]) || [];
  res.json({ success: true, history });
});

app.post("/api/ai/chat", async (req, res) => {
  try {
    // Online Claude when key is present; otherwise use built-in local brain
    // so the platform still works without any paid API.
    if (!ANTHROPIC_API_KEY) {
      const { userId, message } = req.body;
      if (!userId || !message || !message.trim()) {
        return res.status(400).json({ success: false, error: "A message is required." });
      }
      const db = await loadDB();
      if (!db.aiChats) db.aiChats = {};
      const history = db.aiChats[userId] || [];
      history.push({ role: "user", content: message.trim(), timestamp: new Date().toISOString() });

      const replyText = localAIReply(message.trim(), db);
      history.push({ role: "assistant", content: replyText, timestamp: new Date().toISOString() });
      db.aiChats[userId] = history.slice(-AI_HISTORY_LIMIT * 2);
      await saveDB(db);
      return res.json({ success: true, reply: replyText, provider: "local" });
    }

    const { userId, message } = req.body;
    if (!userId || !message || !message.trim()) {
      return res.status(400).json({ success: false, error: "A message is required." });
    }

    const db = await loadDB();
    if (!db.aiChats) db.aiChats = {};
    const history = db.aiChats[userId] || [];

    history.push({ role: "user", content: message.trim(), timestamp: new Date().toISOString() });

    const apiMessages = history
      .slice(-AI_HISTORY_LIMIT)
      .map(m => ({ role: m.role, content: m.content }));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: AI_SYSTEM_PROMPT,
        messages: apiMessages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Claude API error:", data);
      return res.status(502).json({ success: false, error: "GLOBAL AI could not respond right now." });
    }

    const replyText = (data.content || [])
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n")
      .trim() || "I couldn't come up with a reply to that — try rephrasing?";

    history.push({ role: "assistant", content: replyText, timestamp: new Date().toISOString() });
    db.aiChats[userId] = history.slice(-AI_HISTORY_LIMIT * 2);
    await saveDB(db);

    res.json({ success: true, reply: replyText });
  } catch (err) {
    console.error("GLOBAL AI error:", err);
    res.status(500).json({ success: false, error: "GLOBAL AI could not respond right now." });
  }
});

// ======================
// OPPORTUNITIES
// ======================
app.get("/api/opportunities", async (req, res) => {
  const db = await loadDB();
  const now = Date.now();
  const opps = (db.opportunities || []).slice().sort((a, b) => {
    const aFeatured = a.featured && a.featuredUntil && new Date(a.featuredUntil).getTime() > now;
    const bFeatured = b.featured && b.featuredUntil && new Date(b.featuredUntil).getTime() > now;
    if (aFeatured && !bFeatured) return -1;
    if (!aFeatured && bFeatured) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  res.json({ success: true, opportunities: opps });
});

app.post("/api/opportunities", async (req, res) => {
  try {
    const { title, organization, description, type, location, deadline, link, submittedBy } = req.body;
    if (!title || !description) {
      return res.status(400).json({ success: false, error: "Title and description are required." });
    }

    const db = await loadDB();
    const newOpp = {
      id: createId("OPP"),
      title: title.trim(),
      organization: (organization || "").trim(),
      description: description.trim(),
      type: type || "Other",
      location: location || "Remote / Global",
      deadline: deadline || null,
      link: link || null,
      submittedBy: submittedBy || null,
      createdAt: new Date().toISOString(),
      views: 0,
      reports: [],
      featured: false,
      featuredUntil: null
    };

    db.opportunities.unshift(newOpp);
    await saveDB(db);
    res.status(201).json({ success: true, opportunity: newOpp });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not create opportunity." });
  }
});

// ======================
// FEATURED OPPORTUNITIES (Paystack)
// ======================
// Step 1: start a payment. We decide the price here (from FEATURE_PRICING),
// never from anything the browser sends, so it can't be tampered with.
app.post("/api/payments/initialize-feature", async (req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, error: "Payments are not connected yet." });
    }

    const { opportunityId, email, days } = req.body;
    const durationDays = Number(days);
    const amountNaira = FEATURE_PRICING[durationDays];

    if (!opportunityId || !email || !amountNaira) {
      return res.status(400).json({ success: false, error: "A valid opportunity, email, and duration are required." });
    }

    const db = await loadDB();
    const opp = (db.opportunities || []).find(o => o.id === opportunityId);
    if (!opp) {
      return res.status(404).json({ success: false, error: "Opportunity not found." });
    }

    const reference = createId("PAY");

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + PAYSTACK_SECRET_KEY
      },
      body: JSON.stringify({
        email,
        amount: amountNaira * 100, // Paystack expects kobo
        reference,
        callback_url: (req.headers.origin || "") + "/opportunities.html",
        metadata: { opportunityId, days: durationDays }
      })
    });

    const data = await paystackRes.json();

    if (!paystackRes.ok || !data.status) {
      console.error("Paystack initialize error:", data);
      return res.status(502).json({ success: false, error: "Could not start payment." });
    }

    res.json({ success: true, authorizationUrl: data.data.authorization_url, reference });
  } catch (err) {
    console.error("Payment initialize error:", err);
    res.status(500).json({ success: false, error: "Could not start payment." });
  }
});

// Step 2: after Paystack redirects the user back, verify the payment
// server-side before marking anything as featured. Never trust the
// redirect alone — always confirm with Paystack directly.
app.get("/api/payments/verify/:reference", async (req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, error: "Payments are not connected yet." });
    }

    const paystackRes = await fetch(
      "https://api.paystack.co/transaction/verify/" + encodeURIComponent(req.params.reference),
      { headers: { "Authorization": "Bearer " + PAYSTACK_SECRET_KEY } }
    );
    const data = await paystackRes.json();

    if (!paystackRes.ok || !data.status || data.data.status !== "success") {
      return res.status(400).json({ success: false, error: "Payment was not successful." });
    }

    const { opportunityId, days } = data.data.metadata || {};
    const expectedAmount = FEATURE_PRICING[Number(days)];

    // Confirm the amount actually paid matches a real price we set —
    // guards against a tampered or replayed reference.
    if (!expectedAmount || data.data.amount !== expectedAmount * 100) {
      return res.status(400).json({ success: false, error: "Payment amount did not match." });
    }

    const db = await loadDB();
    const opp = (db.opportunities || []).find(o => o.id === opportunityId);
    if (!opp) {
      return res.status(404).json({ success: false, error: "Opportunity not found." });
    }

    const featuredUntil = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString();
    opp.featured = true;
    opp.featuredUntil = featuredUntil;
    await saveDB(db);

    res.json({ success: true, opportunity: opp });
  } catch (err) {
    console.error("Payment verify error:", err);
    res.status(500).json({ success: false, error: "Could not verify payment." });
  }
});

// Report a listing as stale, wrong, or a scam. One report per user, per listing.
app.post("/api/opportunities/:oppId/report", async (req, res) => {
  try {
    const { userId, reason } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required." });

    const db = await loadDB();
    const opp = db.opportunities.find(o => o.id === req.params.oppId);
    if (!opp) return res.status(404).json({ success: false, error: "Opportunity not found." });

    opp.reports = opp.reports || [];

    if (opp.reports.some(r => r.userId === userId)) {
      return res.json({ success: true, message: "Already reported by this user.", opportunity: opp });
    }

    opp.reports.push({
      userId,
      reason: (reason || "").trim().slice(0, 300) || "No reason given",
      createdAt: new Date().toISOString()
    });

    await saveDB(db);
    res.json({ success: true, opportunity: opp });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not submit report." });
  }
});

// ======================
// IDEAS (online)
// ======================
app.get("/api/ideas", async (req, res) => {
  const { helpNeeded, category } = req.query;
  const db = await loadDB();
  let ideas = db.ideas || [];

  if (helpNeeded) {
    ideas = ideas.filter(
      idea => Array.isArray(idea.helpNeeded) && idea.helpNeeded.includes(helpNeeded)
    );
  }

  if (category) {
    ideas = ideas.filter(idea => idea.category === category);
  }

  res.json({ success: true, ideas });
});

app.post("/api/ideas", async (req, res) => {
  try {
    const { title, content, category, authorId, authorName, helpNeeded } = req.body;
    if (!title || !content) {
      return res.status(400).json({ success: false, error: "Title and content are required." });
    }

    // helpNeeded is an optional list of tags like ["Developer", "Funding"]
    // describing what kind of collaborator the idea's author is looking for.
    const cleanHelpNeeded = Array.isArray(helpNeeded)
      ? helpNeeded.filter(tag => typeof tag === "string" && tag.trim()).map(tag => tag.trim()).slice(0, 10)
      : [];

    const db = await loadDB();
    const newIdea = {
      id: createId("IDEA"),
      title: title.trim(),
      content: content.trim(),
      category: category || "General",
      authorId: authorId || null,
      authorName: authorName || "Anonymous",
      helpNeeded: cleanHelpNeeded,
      createdAt: new Date().toISOString(),
      likes: 0
    };

    db.ideas.unshift(newIdea);
    await saveDB(db);
    res.status(201).json({ success: true, idea: newIdea });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not create idea." });
  }
});

// ======================
// PROBLEMS
// ======================
app.get("/api/problems", async (req, res) => {
  const { category, region } = req.query;
  const db = await loadDB();
  let problems = db.problems || [];
  if (category) problems = problems.filter(p => p.category === category);
  if (region) problems = problems.filter(p => (p.region || "").toLowerCase().includes(region.toLowerCase()));
  res.json({ success: true, problems });
});

app.post("/api/problems", async (req, res) => {
  try {
    const { title, content, category, region, authorId, authorName } = req.body;
    if (!title || !content) {
      return res.status(400).json({ success: false, error: "Title and content are required." });
    }
    const db = await loadDB();
    const newProblem = {
      id: createId("PROB"),
      title: title.trim(),
      content: content.trim(),
      category: category || "General",
      region: region || "Global",
      authorId: authorId || null,
      authorName: authorName || "Anonymous",
      createdAt: new Date().toISOString(),
      likes: 0,
      solutions: 0
    };
    db.problems.unshift(newProblem);
    await saveDB(db);
    res.status(201).json({ success: true, problem: newProblem });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not create problem." });
  }
});

// ======================
// PROJECTS
// ======================
app.get("/api/projects", async (req, res) => {
  const { status, category } = req.query;
  const db = await loadDB();
  let projects = db.projects || [];
  if (status) projects = projects.filter(p => p.status === status);
  if (category) projects = projects.filter(p => p.category === category);
  res.json({ success: true, projects });
});

app.post("/api/projects", async (req, res) => {
  try {
    const { title, content, category, status, authorId, authorName, lookingFor } = req.body;
    if (!title || !content) {
      return res.status(400).json({ success: false, error: "Title and content are required." });
    }
    const cleanLookingFor = Array.isArray(lookingFor)
      ? lookingFor.filter(t => typeof t === "string" && t.trim()).map(t => t.trim()).slice(0, 10)
      : [];
    const db = await loadDB();
    const newProject = {
      id: createId("PROJ"),
      title: title.trim(),
      content: content.trim(),
      category: category || "General",
      status: status || "Ideation",
      authorId: authorId || null,
      authorName: authorName || "Anonymous",
      lookingFor: cleanLookingFor,
      createdAt: new Date().toISOString(),
      members: 1,
      likes: 0
    };
    db.projects.unshift(newProject);
    await saveDB(db);
    res.status(201).json({ success: true, project: newProject });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not create project." });
  }
});

// ======================
// MESSAGES (online)
// ======================
app.get("/api/messages", async (req, res) => {
  const { userId } = req.query;
  const db = await loadDB();
  let messages = db.messages || [];

  if (userId) {
    messages = messages.filter(
      m => m.fromUserId === userId || m.toUserId === userId
    );
  }

  // Newest first
  messages = messages.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, messages });
});

app.post("/api/messages", async (req, res) => {
  try {
    const { fromUserId, fromName, toUserId, toName, text } = req.body;
    if (!fromUserId || !toUserId || !text || !text.trim()) {
      return res.status(400).json({ success: false, error: "fromUserId, toUserId and text are required." });
    }

    const db = await loadDB();
    const newMsg = {
      id: createId("MSG"),
      fromUserId,
      fromName: fromName || "User",
      toUserId,
      toName: toName || "User",
      text: text.trim().slice(0, 2000),
      createdAt: new Date().toISOString(),
      read: false
    };

    db.messages.push(newMsg);

    // Also create a notification for the recipient
    db.notifications.push({
      id: createId("NOTIF"),
      userId: toUserId,
      type: "message",
      title: "New message",
      body: `${fromName || "Someone"} sent you a message`,
      relatedId: newMsg.id,
      createdAt: new Date().toISOString(),
      read: false
    });

    await saveDB(db);
    res.status(201).json({ success: true, message: newMsg });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not send message." });
  }
});

// ======================
// TEAMS (online)
// ======================
app.get("/api/teams", async (req, res) => {
  const db = await loadDB();
  res.json({ success: true, teams: db.teams || [] });
});

app.post("/api/teams", async (req, res) => {
  try {
    const { name, description, creatorId, creatorName } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: "Team name is required." });
    }

    const db = await loadDB();
    const newTeam = {
      id: createId("TEAM"),
      name: name.trim(),
      description: (description || "").trim(),
      creatorId: creatorId || null,
      creatorName: creatorName || "Unknown",
      members: creatorId ? [creatorId] : [],
      createdAt: new Date().toISOString()
    };

    db.teams.unshift(newTeam);
    await saveDB(db);
    res.status(201).json({ success: true, team: newTeam });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not create team." });
  }
});

app.post("/api/teams/:teamId/join", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required." });

    const db = await loadDB();
    const team = db.teams.find(t => t.id === req.params.teamId);
    if (!team) return res.status(404).json({ success: false, error: "Team not found." });

    if (!team.members.includes(userId)) {
      team.members.push(userId);
      await saveDB(db);
    }

    res.json({ success: true, team });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not join team." });
  }
});

// ======================
// MENTORSHIP
// ======================

// List everyone who has opted in as a mentor
app.get("/api/mentors", async (req, res) => {
  const db = await loadDB();
  const mentors = (db.users || [])
    .filter(u => u.isMentor)
    .map(({ passwordHash, ...u }) => u);
  res.json({ success: true, mentors });
});

// List mentorship requests involving a user, either as mentor or mentee
app.get("/api/mentorships", async (req, res) => {
  const { userId, role } = req.query;
  const db = await loadDB();
  let items = db.mentorships || [];
  if (userId) {
    items = items.filter(m =>
      role === "mentor" ? m.mentorId === userId :
      role === "mentee" ? m.menteeId === userId :
      m.mentorId === userId || m.menteeId === userId
    );
  }
  items = items.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, mentorships: items });
});

// Request mentorship from a mentor
app.post("/api/mentorships", async (req, res) => {
  try {
    const { mentorId, mentorName, menteeId, menteeName, message } = req.body;
    if (!mentorId || !menteeId) {
      return res.status(400).json({ success: false, error: "mentorId and menteeId are required." });
    }
    if (mentorId === menteeId) {
      return res.status(400).json({ success: false, error: "You can't request mentorship from yourself." });
    }

    const db = await loadDB();
    const mentor = db.users.find(u => u.userId === mentorId);
    if (!mentor || !mentor.isMentor) {
      return res.status(404).json({ success: false, error: "Mentor not found." });
    }

    const existing = (db.mentorships || []).find(
      m => m.mentorId === mentorId && m.menteeId === menteeId && m.status === "pending"
    );
    if (existing) {
      return res.status(409).json({ success: false, error: "You already have a pending request with this mentor." });
    }

    const newRequest = {
      id: createId("MENTOR"),
      mentorId,
      mentorName: mentorName || mentor.fullName || mentor.username,
      menteeId,
      menteeName: menteeName || "A GLOBAL member",
      message: (message || "").trim().slice(0, 1000),
      status: "pending", // pending | accepted | declined
      createdAt: new Date().toISOString(),
      respondedAt: null
    };

    db.mentorships.unshift(newRequest);

    db.notifications.push({
      id: createId("NOTIF"),
      userId: mentorId,
      type: "mentorship_request",
      title: "New mentorship request",
      body: `${newRequest.menteeName} would like you as a mentor`,
      relatedId: newRequest.id,
      createdAt: new Date().toISOString(),
      read: false
    });

    await saveDB(db);
    res.status(201).json({ success: true, mentorship: newRequest });
  } catch (err) {
    console.error("Mentorship request error:", err);
    res.status(500).json({ success: false, error: "Could not send mentorship request." });
  }
});

// Mentor accepts or declines a request
app.post("/api/mentorships/:id/respond", async (req, res) => {
  try {
    const { status } = req.body; // "accepted" | "declined"
    if (!["accepted", "declined"].includes(status)) {
      return res.status(400).json({ success: false, error: "status must be 'accepted' or 'declined'." });
    }

    const db = await loadDB();
    const request = (db.mentorships || []).find(m => m.id === req.params.id);
    if (!request) return res.status(404).json({ success: false, error: "Request not found." });

    request.status = status;
    request.respondedAt = new Date().toISOString();

    db.notifications.push({
      id: createId("NOTIF"),
      userId: request.menteeId,
      type: "mentorship_response",
      title: status === "accepted" ? "Mentorship accepted!" : "Mentorship request declined",
      body: status === "accepted"
        ? `${request.mentorName} accepted your mentorship request`
        : `${request.mentorName} isn't able to take this on right now`,
      relatedId: request.id,
      createdAt: new Date().toISOString(),
      read: false
    });

    await saveDB(db);
    res.json({ success: true, mentorship: request });
  } catch (err) {
    console.error("Mentorship respond error:", err);
    res.status(500).json({ success: false, error: "Could not update request." });
  }
});

// ======================
// POSTS (Home feed)
// ======================

// List posts for the Home feed, newest first
app.get("/api/posts", async (req, res) => {
  const db = await loadDB();
  let posts = (db.posts || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const category = String(req.query.category || "all").toLowerCase();
  if (category && category !== "all" && category !== "latest" && category !== "following") {
    posts = posts.filter(p => String(p.category || "general").toLowerCase() === category);
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10) || 10, 1), 50);
  const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);
  const total = posts.length;
  const page = posts.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  res.json({
    success: true,
    posts: page,
    total,
    limit,
    offset,
    hasMore,
    nextOffset: hasMore ? offset + limit : null
  });
});

// Create a new post
app.post("/api/posts", async (req, res) => {
  try {
    const { authorId, authorName, authorAvatar, text, imageBase64, videoBase64 } = req.body;

    if (!authorId || (!text || !String(text).trim()) && !imageBase64 && !videoBase64) {
      return res.status(400).json({
        success: false,
        error: "Write something or choose an image before posting."
      });
    }

    const db = await loadDB();

    const postId = createId("POST");
    // Optional post image.
    if (imageBase64 && videoBase64) {
      return res.status(400).json({
        success: false,
        error: "Choose a photo or a video, not both in one post."
      });
    }

    let imageUrl = null;
    let videoUrl = null;

    if (imageBase64) {
      const match = String(imageBase64).match(
        /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/
      );

      if (!match) {
        return res.status(400).json({
          success: false,
          error: "Unsupported image. Use PNG, JPG, GIF, or WEBP."
        });
      }

      const ext = match[1] === "jpeg" ? "jpg" : match[1];
      const buffer = Buffer.from(match[2], "base64");

      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          error: "Image is too large. Maximum size is 5MB."
        });
      }

      const fileName = `${postId}.${ext}`;
      fs.writeFileSync(
        path.join(POST_IMAGE_DIR, fileName),
        buffer
      );

      imageUrl = `/uploads/posts/${fileName}`;
    }

    // Optional post video. Browser/mobile camera uploads are accepted.
    if (videoBase64) {
      const match = String(videoBase64).match(
        /^data:video\/(mp4|webm|ogg|quicktime|x-m4v);base64,(.+)$/i
      );

      if (!match) {
        return res.status(400).json({
          success: false,
          error: "Unsupported video. Use MP4, WEBM, OGG, or MOV-compatible video."
        });
      }

      const mime = match[1].toLowerCase();
      const extMap = { mp4: "mp4", webm: "webm", ogg: "ogv", quicktime: "mov", "x-m4v": "m4v" };
      const ext = extMap[mime] || "mp4";
      const buffer = Buffer.from(match[2], "base64");

      if (buffer.length > 20 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          error: "Video is too large. Maximum size is 20MB."
        });
      }

      const fileName = `${postId}.${ext}`;
      fs.writeFileSync(
        path.join(POST_VIDEO_DIR, fileName),
        buffer
      );

      videoUrl = `/uploads/videos/${fileName}`;
    }

    const newPost = {
      id: postId,
      authorId,
      authorName: authorName || "Someone",
      authorAvatar: authorAvatar || null,
      username: String(req.body.username || "builder").trim().replace(/^@/, "") || "builder",
      text: String(text || "").trim().slice(0, 3000),
      imageUrl,
      videoUrl,
      category: String(req.body.category || "general").trim().toLowerCase(),
      tags: Array.isArray(req.body.tags) ? req.body.tags.slice(0, 10) : [],
      createdAt: new Date().toISOString(),
      likes: [],
      comments: []
    };

    db.posts.unshift(newPost);

    if (!(await saveDB(db))) {
      return res.status(500).json({
        success: false,
        error: "Could not save post."
      });
    }

    res.status(201).json({
      success: true,
      post: newPost
    });

  } catch (err) {
    console.error("Create post error:", err);
    res.status(500).json({
      success: false,
      error: "Could not create post."
    });
  }
});

// Like / unlike a post (toggle)
app.post("/api/posts/:postId/like", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required." });

    const db = await loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    if (!post) return res.status(404).json({ success: false, error: "Post not found." });

    post.likes = post.likes || [];
    const alreadyLiked = post.likes.includes(userId);

    if (alreadyLiked) {
      post.likes = post.likes.filter(id => id !== userId);
    } else {
      post.likes.push(userId);
    }

    await saveDB(db);
    res.json({ success: true, post, liked: !alreadyLiked });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not update like." });
  }
});

// Add a comment to a post
app.post("/api/posts/:postId/comment", async (req, res) => {
  try {
    const { authorId, authorName, text } = req.body;
    if (!authorId || !text || !text.trim()) {
      return res.status(400).json({ success: false, error: "authorId and text are required." });
    }

    const db = await loadDB();
    const post = db.posts.find(p => p.id === req.params.postId);
    if (!post) return res.status(404).json({ success: false, error: "Post not found." });

    const comment = {
      id: createId("CMT"),
      authorId,
      authorName: authorName || "Someone",
      text: text.trim().slice(0, 1000),
      createdAt: new Date().toISOString()
    };

    post.comments = post.comments || [];
    post.comments.push(comment);

    await saveDB(db);
    res.status(201).json({ success: true, comment, post });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not add comment." });
  }
});

// ======================
// NOTIFICATIONS
// ======================
app.get("/api/notifications", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: "userId required." });

  const db = await loadDB();
  const notifs = (db.notifications || [])
    .filter(n => n.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ success: true, notifications: notifs });
});

app.post("/api/notifications/read", async (req, res) => {
  try {
    const { userId, notificationId } = req.body;
    const db = await loadDB();

    if (notificationId) {
      const n = db.notifications.find(x => x.id === notificationId && x.userId === userId);
      if (n) n.read = true;
    } else if (userId) {
      db.notifications.forEach(n => {
        if (n.userId === userId) n.read = true;
      });
    }

    await saveDB(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not update notifications." });
  }
});

// ======================
// SAVED RESEARCH (online)
// ======================
app.get("/api/saved-research", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: "userId required." });

  const db = await loadDB();
  const items = (db.savedResearch || []).filter(r => r.userId === userId);
  res.json({ success: true, items });
});

app.post("/api/saved-research", async (req, res) => {
  try {
    const { userId, research } = req.body;
    if (!userId || !research) {
      return res.status(400).json({ success: false, error: "userId and research are required." });
    }

    const db = await loadDB();
    const exists = (db.savedResearch || []).some(
      r => r.userId === userId && r.title === research.title
    );

    if (exists) {
      return res.json({ success: true, message: "Already saved." });
    }

    db.savedResearch.push({
      id: createId("RES"),
      userId,
      ...research,
      savedAt: new Date().toISOString()
    });

    await saveDB(db);
    res.status(201).json({ success: true, message: "Research saved." });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not save research." });
  }
});

// ======================
// RESEARCH (OpenAlex)
// ======================
app.get("/api/research", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const page = Math.max(parseInt(req.query.page || "1"), 1);

    if (!query) {
      return res.status(400).json({ success: false, error: "Please provide a research query." });
    }

    const url =
      "https://api.openalex.org/works" +
      "?search=" + encodeURIComponent(query) +
      "&page=" + page +
      "&per-page=10" +
      "&sort=relevance_score:desc";

    const response = await fetch(url);
    if (!response.ok) throw new Error(`OpenAlex returned ${response.status}`);

    const data = await response.json();

    const results = (data.results || []).map((item) => {
      const authors = (item.authorships || [])
        .slice(0, 5)
        .map((author) => author.author?.display_name)
        .filter(Boolean);

      return {
        id: item.id || null,
        title: item.display_name || "Untitled research",
        publicationDate: item.publication_date || null,
        year: item.publication_year || null,
        type: item.type || null,
        authors,
        journal: item.primary_location?.source?.display_name || null,
        doi: item.doi || null,
        abstract: getAbstract(item),
        citedBy: item.cited_by_count || 0,
        openAccess: item.open_access?.is_oa || false,
        sourceUrl: item.primary_location?.landing_page_url || item.doi || item.id || null
      };
    });

    res.json({
      success: true,
      query,
      page,
      totalResults: data.meta?.count || results.length,
      results
    });
  } catch (error) {
    console.error("GLOBAL Research Error:", error);
    res.status(500).json({
      success: false,
      error: "GLOBAL Research could not retrieve research results.",
      details: error.message
    });
  }
});

function getAbstract(work) {
  const invertedIndex = work?.abstract_inverted_index;
  if (!invertedIndex) return "Abstract not available.";
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of positions) {
      words[position] = word;
    }
  }
  return words.filter(Boolean).join(" ");
}

app.get("/api/categories", async (req, res) => {
  res.json({
    success: true,
    categories: [
      { id: "technology", name: "Technology & AI", query: "artificial intelligence technology" },
      { id: "medicine", name: "Medicine & Drugs", query: "medicine drug research" },
      { id: "biotechnology", name: "Biotechnology", query: "biotechnology research" },
      { id: "energy", name: "Energy", query: "energy battery renewable energy" },
      { id: "agriculture", name: "Agriculture", query: "agriculture food technology" },
      { id: "climate", name: "Climate & Environment", query: "climate environmental science" },
      { id: "space", name: "Space & Astronomy", query: "space astronomy research" },
      { id: "engineering", name: "Engineering", query: "engineering research" },
      { id: "health", name: "Health & Human Science", query: "health human science research" },
      { id: "science", name: "General Science", query: "scientific research" }
    ]
  });
});

// ======================
// START
// ======================


// ======================
// SEARCH
// ======================
app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (!q || q.length < 2) {
      return res.json({ success: true, results: [], query: q });
    }
    const db = await loadDB();
    const results = [];
    const score = (text) => {
      if (!text) return 0;
      const t = String(text).toLowerCase();
      let s = 0;
      q.split(/\s+/).forEach(w => { if (w.length > 1 && t.includes(w)) s += 1; });
      return s;
    };
    (db.problems || []).forEach(p => {
      const s = score((p.title || "") + " " + (p.description || "") + " " + (p.category || ""));
      if (s) results.push({ type: "problem", score: s, id: p.id, title: p.title, description: (p.description || "").slice(0, 200) });
    });
    (db.ideas || []).forEach(i => {
      const s = score((i.title || "") + " " + (i.content || "") + " " + (i.category || ""));
      if (s) results.push({ type: "idea", score: s, id: i.id, title: i.title, description: (i.content || "").slice(0, 200) });
    });
    (db.projects || []).forEach(p => {
      const s = score((p.title || "") + " " + (p.description || ""));
      if (s) results.push({ type: "project", score: s, id: p.id, title: p.title, description: (p.description || "").slice(0, 200) });
    });
    (db.opportunities || []).forEach(o => {
      const s = score((o.title || "") + " " + (o.description || ""));
      if (s) results.push({ type: "opportunity", score: s, id: o.id, title: o.title, description: (o.description || "").slice(0, 200) });
    });
    (db.teams || []).forEach(t => {
      const s = score((t.name || "") + " " + (t.description || ""));
      if (s) results.push({ type: "team", score: s, id: t.id, title: t.name, description: (t.description || "").slice(0, 200) });
    });
    (db.users || []).forEach(u => {
      const s = score((u.fullName || "") + " " + (u.username || "") + " " + (u.bio || ""));
      if (s) results.push({ type: "person", score: s, id: u.userId, title: u.fullName || u.username, description: u.bio || u.location || "" });
    });
    results.sort((a, b) => b.score - a.score);
    res.json({ success: true, query: q, results: results.slice(0, 30) });
  } catch (err) {
    res.status(500).json({ success: false, error: "Search failed." });
  }
});

// ======================
// REPORTS & MODERATION
// ======================
// Anyone logged in can report content. Admins (isAdmin flag) can review.

app.post("/api/report", async (req, res) => {
  try {
    const { targetType, targetId, reporterId, reason } = req.body;
    const allowed = ["opportunity", "idea", "problem", "project", "post", "user", "team"];
    if (!targetType || !targetId || !reporterId) {
      return res.status(400).json({ success: false, error: "targetType, targetId and reporterId are required." });
    }
    if (!allowed.includes(targetType)) {
      return res.status(400).json({ success: false, error: "Invalid targetType." });
    }

    const db = await loadDB();
    if (!Array.isArray(db.reports)) db.reports = [];

    // one open report per user per target
    const existing = db.reports.find(r =>
      r.targetType === targetType && r.targetId === targetId &&
      r.reporterId === reporterId && (r.status || "open") === "open"
    );
    if (existing) {
      return res.json({ success: true, message: "You already reported this.", report: existing });
    }

    const report = {
      id: createId("RPT"),
      targetType,
      targetId,
      reporterId,
      reason: String(reason || "No reason given").trim().slice(0, 500),
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      notes: null
    };
    db.reports.unshift(report);

    // also attach to opportunity.reports for backward compatibility
    if (targetType === "opportunity") {
      const opp = (db.opportunities || []).find(o => o.id === targetId);
      if (opp) {
        opp.reports = opp.reports || [];
        if (!opp.reports.some(r => r.userId === reporterId)) {
          opp.reports.push({ userId: reporterId, reason: report.reason, createdAt: report.createdAt });
        }
      }
    }

    await saveDB(db);
    res.status(201).json({ success: true, report });
  } catch (err) {
    console.error("Report error:", err);
    res.status(500).json({ success: false, error: "Could not submit report." });
  }
});

app.get("/api/reports", async (req, res) => {
  try {
    const db = await loadDB();
    const status = req.query.status || "open";
    let list = Array.isArray(db.reports) ? db.reports.slice() : [];
    if (status !== "all") list = list.filter(r => (r.status || "open") === status);
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, reports: list, total: list.length });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not load reports." });
  }
});

app.post("/api/reports/:reportId/resolve", async (req, res) => {
  try {
    const { resolverId, notes, action } = req.body; // action: dismiss | remove_content
    const db = await loadDB();
    if (!Array.isArray(db.reports)) db.reports = [];
    const report = db.reports.find(r => r.id === req.params.reportId);
    if (!report) return res.status(404).json({ success: false, error: "Report not found." });

    // simple admin check: user must have isAdmin true
    const resolver = (db.users || []).find(u => u.userId === resolverId);
    if (!resolver || !resolver.isAdmin) {
      return res.status(403).json({ success: false, error: "Admin access required." });
    }

    report.status = "resolved";
    report.resolvedAt = new Date().toISOString();
    report.resolvedBy = resolverId;
    report.notes = (notes || action || "resolved").slice(0, 500);

    if (action === "remove_content") {
      const map = {
        opportunity: "opportunities", idea: "ideas", problem: "problems",
        project: "projects", post: "posts", team: "teams"
      };
      const coll = map[report.targetType];
      if (coll && Array.isArray(db[coll])) {
        db[coll] = db[coll].filter(item => item.id !== report.targetId);
      }
    }

    await saveDB(db);
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not resolve report." });
  }
});



// Ensure Founder & CEO admin exists (for moderation)
// Passwords are never hardcoded here — they come from environment variables,
// or a random one-time password is generated and printed to the server log
// once, so nobody can just read a password out of the source code.
function resolveAdminPassword(envVar, label) {
  if (process.env[envVar]) return process.env[envVar];
  const generated = crypto.randomBytes(9).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  console.log(`No ${envVar} set — generated a one-time ${label} password: ${generated}`);
  console.log(`Log in once with it, then set ${envVar} on your host so it doesn't regenerate on the next restart.`);
  return generated;
}

(async function ensureFounder() {
  try {
    const db = await loadDB();
    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.reports)) db.reports = [];
    let changed = false;
    if (!db.users.some(u => u.username === "founder")) {
      db.users.unshift({
        userId: "GLOBAL-founder-001",
        fullName: "Maridiyat Salaudeen",
        username: "founder",
        email: "founder@global.org",
        phone: "+234 905 510 1337",
        passwordHash: hashPassword(resolveAdminPassword("FOUNDER_PASSWORD", "Founder")),
        createdAt: new Date().toISOString(),
        lastLogin: null,
        bio: "Founder of GLOBAL Organisation.",
        location: "Lagos, Nigeria",
        website: "",
        avatar: null,
        isAdmin: true,
        role: "Founder"
      });
      changed = true;
      console.log("Seeded Founder account (username: founder)");
    }
    if (!db.users.some(u => u.username === "ceo")) {
      db.users.unshift({
        userId: "GLOBAL-ceo-001",
        fullName: "Sultanic the iconic",
        username: "ceo",
        email: "hassansultoon826@gmail.com",
        passwordHash: hashPassword(resolveAdminPassword("CEO_PASSWORD", "CEO")),
        createdAt: new Date().toISOString(),
        lastLogin: null,
        bio: "CEO of GLOBAL Organisation — Sultanic the iconic.",
        location: "Lagos, Nigeria",
        website: "",
        avatar: null,
        isAdmin: true,
        role: "CEO"
      });
      changed = true;
      console.log("Seeded CEO account (username: ceo)");
    }
    if (changed) await saveDB(db);
  } catch (e) {
    console.error("Founder seed error:", e.message);
  }
})();

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`GLOBAL Organisation API running on http://0.0.0.0:${PORT}`);
  console.log(`Database mode: ${getMode()} · data dir: ${DATA_DIR}`);
  console.log(`Online services:`);
  console.log(`  GLOBAL AI (Anthropic): ${ANTHROPIC_API_KEY ? "connected" : "not set (local fallback active)"}`);
  console.log(`  News (GNews):          ${GNEWS_API_KEY ? "connected" : "not set (local fallback)"}`);
  console.log(`  Payments (Paystack):   ${PAYSTACK_SECRET_KEY ? "connected" : "not set"}`);
  console.log(`  Research (OpenAlex):   always online (free, no key)`);
});

server.on("error", (err) => {
  console.error("Server failed to start:", err.message);
  process.exit(1);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

