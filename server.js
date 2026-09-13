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
    return "I
