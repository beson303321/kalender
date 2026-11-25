// ─────────────────────────────────────────────────────────────
//  Einstellungen der Webseite
// ─────────────────────────────────────────────────────────────

// Name, der oben auf der Seite steht
export const SITE_NAME = "26aTB1";

// Benutzernamen für den Login.
// Firebase braucht intern E-Mail-Adressen, deshalb wird aus
// "klasse" automatisch "klasse@26atb1.ch" (es werden nie E-Mails verschickt).
export const LOGIN_DOMAIN = "26atb1.ch";
export const CLASS_USERNAME = "klasse";
export const ADMIN_USERNAME = "admin";

// Firebase-Konfiguration: hier die Werte aus der Firebase-Konsole einfügen
// (Projekteinstellungen → Allgemein → Deine Apps → Web-App → "Konfiguration").
// Diese Werte sind NICHT geheim – sie dürfen öffentlich auf GitHub stehen.
// Solange apiKey leer ist, läuft die Seite im Demo-Modus (Daten nur lokal im Browser).
export const firebaseConfig = {
  apiKey: "AIzaSyBjuqBYdgWa6tR60OK8ctod_qami0mw9U8",
  authDomain: "atb1-e5dd2.firebaseapp.com",
  projectId: "atb1-e5dd2",
  storageBucket: "atb1-e5dd2.firebasestorage.app",
  messagingSenderId: "574515518490",
  appId: "1:574515518490:web:7800e7bd74dbbe5a3c45a3",
};
