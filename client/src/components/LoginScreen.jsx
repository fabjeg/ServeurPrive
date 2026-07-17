import { useEffect, useState } from "react";
import { api } from "../api.js";

export function LoginScreen({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authConfig().then((c) => setTotpEnabled(c.totpEnabled)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(email, password, totp || undefined);
      onSuccess();
    } catch (err) {
      if (err.totpRequired) setTotpEnabled(true);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <p className="login__brand">Private Server</p>
        <p className="login__tagline">Serveur de documents privé — accès réservé.</p>

        <label className="field">
          <span className="field__label">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Mot de passe</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {totpEnabled && (
          <label className="field">
            <span className="field__label">Code 2FA</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              autoComplete="one-time-code"
              placeholder="000000"
            />
          </label>
        )}

        {error && <p className="login__error">{error}</p>}

        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? "Ouverture…" : "Déverrouiller"}
        </button>
      </form>
    </div>
  );
}
