// ---------- 1. Connect to the database (Supabase) ----------
// Copy these two values from your Supabase project (Connect button).
const SUPABASE_URL = "https://ssqqqarruuvsiuoahchr.supabase.co";
const SUPABASE_KEY = "sb_publishable_xRJ5tcamhWmjq7qFVd6J_g_aTd3G6WX";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- 2. Grab the elements we need ----------
const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const authMessage = document.getElementById("auth-message");
const displayName = document.getElementById("display-name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const signupBtn = document.getElementById("signup-btn");
const logoutBtn = document.getElementById("logout-btn");
const who = document.getElementById("who");
const messageList = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

// ---------- 3. What the app remembers while it runs ----------
let currentUser = null; // the logged-in user, or null
const names = {}; // user id -> display name
let channel = null; // the realtime connection (used in Part 4)

// ---------- 4. Sign up, log in, log out ----------
async function signUp() {
  const name = displayName.value.trim();
  if (name.length < 2) {
    authMessage.textContent = "Enter a display name (2 to 24 characters).";
    return;
  }

  authMessage.textContent = "Creating your account...";
  const { data, error } = await sb.auth.signUp({
    email: emailInput.value.trim(),
    password: passwordInput.value,
    options: { data: { display_name: name } },
  });

  if (error) {
    authMessage.textContent = error.message;
  } else if (data.session) {
    authMessage.textContent = "Check your email to confirm your account.";
  } else {
    authMessage.textContent = "";
  }
}

async function logIn() {
  authMessage.textContent = "Logging in...";
  const { error } = await sb.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value,
  });
  authMessage.textContent = error ? error.message : "";
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault(); // stop the page from reloading
  logIn();
});

signupBtn.addEventListener("click", () => {
  if (authForm.reportValidity()) signUp();
});

logoutBtn.addEventListener("click", () => sb.auth.signOut());

// ---------- 5. React when the login state changes ----------
sb.auth.onAuthStateChange((event, session) => {
  const user = session ? session.user : null;

  // setTimeout lets Supabase finish its own work before we call it again
  setTimeout(() => {
    if (user && (!currentUser || currentUser.id !== user.id)) startChat(user);
    if (!user && currentUser) stopChat();
  }, 0);
});

// ---------- 6. Start and stop the chat room ----------
async function startChat(user) {
  currentUser = user;
  authScreen.hidden = true;
  chatScreen.hidden = false;
  who.textContent = "Loading...";

  await loadNames();
  who.textContent = names[user.id] || "Signed in";
  await loadMessages();
  listenForNewMessages();
  messageInput.focus();
}

function stopChat() {
  currentUser = null;
  if (channel) sb.removeChannel(channel);
  channel = null;
  emailInput.value = "";
  passwordInput.value = "";
  chatScreen.hidden = true;
  authScreen.hidden = false;
}

// ---------- 7. Show one message on the screen ----------
function showMessage(msg) {
  // Skip if it is already on the screen (this matters in Part 4)
  if (messageList.querySelector(`[data-id="${ msg.id }"]`)) return;

  const isMine = msg.user_id === currentUser.id;
  const item = document.createElement("li");
  item.className = isMine ? "message mine" : "message";
  item.dataset.id = msg.id;

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = names[msg.user_id] || "Unknown";

  const text = document.createElement("p");
  // textContent (not innerHTML) keeps the page safe from injected HTML
  text.textContent = msg.content;

  const time = document.createElement("time");
  time.textContent = new Date(msg.created_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  item.append(author, text, time);
  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}

// ---------- 8. Send a message to the database (INSERT) ----------
messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const content = messageInput.value.trim();
  if (content === "") return;
  messageInput.value = "";

  // Commands such as /weather stay on your screen. They are not saved.
  if (content.startsWith("/")) {
    handleCommand(content);
    return;
  }

  const { data, error } = await insertMessage(content);
  if (error) {
    console.error(error);
    showFailedMessage(content);
    return;
  }
  showMessage(data);
});

async function insertMessage(content) {
  // We send ONLY the text. The database fills in who sent it.
  return sb
    .from("messages")
    .insert({ content: content })
    .select()
    .single();
}

function showFailedMessage(content) {
  const item = document.createElement("li");
  item.className = "message mine failed";

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = names[currentUser.id] || "You";

  const text = document.createElement("p");
  text.textContent = content;

  const status = document.createElement("span");
  status.className = "send-status";
  status.textContent = "Failed to send. ";

  const retry = document.createElement("a");
  retry.className = "retry-link";
  retry.href = "#";
  retry.textContent = "Retry";
  retry.setAttribute("aria-label", "Retry sending this message");
  retry.addEventListener("click", async (event) => {
    event.preventDefault();
    if (retry.dataset.retrying === "true") return;

    retry.dataset.retrying = "true";
    retry.textContent = "Retrying...";
    retry.setAttribute("aria-disabled", "true");

    const { data, error } = await insertMessage(content);
    if (error) {
      console.error(error);
      retry.textContent = "Retry";
      retry.dataset.retrying = "false";
      retry.removeAttribute("aria-disabled");
      return;
    }

    item.remove();
    showMessage(data);
  });

  status.appendChild(retry);
  item.append(author, text, status);
  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}

//--------- 9. Read the data from the database (SELECT) ----------
async function loadNames() {
  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name");
  if (error) return console.error(error);

  data.forEach((p) => {
    names[p.id] = p.display_name;
  });
}

async function loadMessages() {
  const { data, error } = await sb
    .from("messages")
    .select("id, user_id, content, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return console.error(error);

  messageList.innerHTML = "";
  data.reverse().forEach(showMessage);
}

// ---------- 10. Get new messages instantly (Realtime) ----------
async function nameFor(userId) {
  if (!names[userId]) {
    const { data } = await sb
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();
    names[userId] = data ? data.display_name : "Unknown";
  }
  return names[userId];
}

function listenForNewMessages() {
  if (channel) sb.removeChannel(channel);

  channel = sb
    .channel("class-chat")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      async (payload) => {
        await nameFor(payload.new.user_id);
        showMessage(payload.new);
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "messages" },
      (payload) => removeMessage(payload.old.id)
    )
    .subscribe();
}

function removeMessage(id) {
  const item = messageList.querySelector(`[data-id="${ id }"]`);
  if (item) item.remove();
}

// ---------- 11. API: a private weather bot (GET) ----------
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const HOME_TOWN_KEY = "class-chat-home-town";

function describeWeather(code) {
  if (code === 0) return "clear sky";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "foggy";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorm";
}

async function getWeather(city) {
  // Request 1: turn the city name into latitude and longitude
  const geoUrl = GEO_URL + "?name=" + encodeURIComponent(city) + "&count=1";
  const geoResponse = await fetch(geoUrl);
  if (!geoResponse.ok) throw new Error("Geocoding failed");
  const geoData = await geoResponse.json();

  if (!geoData.results) {
    return "Sorry, I could not find a city named " + city + ".";
  }
  const place = geoData.results[0];

  // Request 2: ask for the current weather at those coordinates
  const weatherUrl =
    WEATHER_URL +
    "?latitude=" + place.latitude +
    "&longitude=" + place.longitude +
    "&current=temperature_2m,weather_code,wind_speed_10m" +
    "&temperature_unit=fahrenheit";
  const weatherResponse = await fetch(weatherUrl);
  if (!weatherResponse.ok) throw new Error("Weather failed");
  const weatherData = await weatherResponse.json();
  const now = weatherData.current;

  return (
    place.name + ", " + place.country + " : " +
    now.temperature_2m + " degrees F, " +
    describeWeather(now.weather_code) + ", wind " +
    now.wind_speed_10m + " km/h"
  );
}

async function handleCommand(text) {
  const words = text.split(" ");

  if (words[0].toLowerCase() !== "/weather") {
    showBotMessage("Unknown command. Try: /weather Manila or /weather home");
    return;
  }

  let city = words.slice(1).join(" ").trim();
  if (city === "") {
    showBotMessage("Try /weather Manila or /weather home.");
    return;
  }

  if (city.toLowerCase() === "home") {
    try {
      city = localStorage.getItem(HOME_TOWN_KEY);
      if (!city) {
        const answer = window.prompt("What is your home town?");
        if (answer === null) {
          showBotMessage("Home town was not set.");
          return;
        }
        city = answer.trim();
        if (!city) {
          showBotMessage("Enter a town next time you use /weather home.");
          return;
        }
        localStorage.setItem(HOME_TOWN_KEY, city);
      }
    } catch (error) {
      console.error(error);
      showBotMessage("I could not save your home town in this browser.");
      return;
    }
  }

  try {
    showBotMessage(await getWeather(city));
  } catch (error) {
    console.error(error);
    showBotMessage("The weather service is not answering right now.");
  }
}

function showBotMessage(text) {
  const item = document.createElement("li");
  item.className = "message bot";

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = "WeatherBot (only you can see this)";

  const body = document.createElement("p");
  body.textContent = text;

  item.append(author, body);
  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}