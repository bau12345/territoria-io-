function getBaseUrl() {
  return window.location.origin + window.location.pathname.replace(/[^/]*$/, "");
}
function setMessage(id, text, success=false) {
  const el = document.getElementById(id); if (!el) return;
  el.textContent = text; el.classList.toggle("success", success);
}
function friendlyError(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (m.includes("email not confirmed")) return "Primero confirmá tu correo electrónico.";
  if (m.includes("user already registered")) return "Ya existe una cuenta con ese correo.";
  if (m.includes("too many") || m.includes("rate limit")) return "Demasiados intentos. Esperá un momento y probá nuevamente.";
  return message || "Ocurrió un error. Intentá nuevamente.";
}

const loginForm = document.getElementById("loginForm");
if (loginForm) loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  setMessage("loginMessage", "Ingresando...");
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return setMessage("loginMessage", friendlyError(error.message));
  if (data.session) window.location.replace("mapa.html");
});

const registerForm = document.getElementById("registerForm");
if (registerForm) registerForm.addEventListener("submit", async e => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (password.length < 6) return setMessage("registerMessage", "La contraseña debe tener al menos 6 caracteres.");
  setMessage("registerMessage", "Creando cuenta...");
  const { data, error } = await supabaseClient.auth.signUp({
    email, password,
    options: { data: { username }, emailRedirectTo: getBaseUrl() + "index.html" }
  });
  if (error) return setMessage("registerMessage", friendlyError(error.message));
  if (data.session) return window.location.replace("mapa.html");
  setMessage("registerMessage", "Cuenta creada. Revisá tu correo para confirmar la cuenta.", true);
});

const forgotForm = document.getElementById("forgotForm");
if (forgotForm) forgotForm.addEventListener("submit", async e => {
  e.preventDefault();
  setMessage("forgotMessage", "Enviando enlace...");
  const email = document.getElementById("forgotEmail").value.trim();
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: getBaseUrl() + "reset-password.html" });
  if (error) return setMessage("forgotMessage", friendlyError(error.message));
  setMessage("forgotMessage", "Listo. Revisá tu correo para cambiar la contraseña.", true);
});

const newPasswordForm = document.getElementById("newPasswordForm");
if (newPasswordForm) {
  supabaseClient.auth.getSession().then(({data}) => {
    if (data.session) {
      document.getElementById("forgotForm")?.classList.add("hidden");
      newPasswordForm.classList.remove("hidden");
      document.getElementById("resetTitle").textContent = "Nueva contraseña";
      document.getElementById("resetDescription").textContent = "Elegí una nueva contraseña para tu cuenta.";
    }
  });
  newPasswordForm.addEventListener("submit", async e => {
    e.preventDefault();
    const password = document.getElementById("newPassword").value;
    const confirmation = document.getElementById("newPasswordConfirm").value;
    if (password.length < 6) return setMessage("newPasswordMessage", "La contraseña debe tener al menos 6 caracteres.");
    if (password !== confirmation) return setMessage("newPasswordMessage", "Las contraseñas no coinciden.");
    setMessage("newPasswordMessage", "Guardando...");
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) return setMessage("newPasswordMessage", friendlyError(error.message));
    setMessage("newPasswordMessage", "Contraseña actualizada correctamente.", true);
    await supabaseClient.auth.signOut();
    setTimeout(() => window.location.replace("index.html"), 1200);
  });
}

if (window.location.pathname.toLowerCase().endsWith("/mapa.html")) {
  supabaseClient.auth.getSession().then(({data}) => {
    if (!data.session) window.location.replace("index.html");
  });
}

const logoutButton = document.getElementById("logoutButton");
if (logoutButton) logoutButton.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.replace("index.html");
});
