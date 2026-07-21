import { useEffect, useState } from "react";
import { api } from "./api.js";
import { LoginScreen } from "./components/LoginScreen.jsx";
import { ProSpace } from "./pages/ProSpace.jsx";
import { useTheme } from "./hooks/useTheme.js";

export function App() {
  const { preference: themePreference, choosePreference: onChooseTheme } = useTheme();
  const [authState, setAuthState] = useState("checking"); // checking | anonymous | authenticated

  useEffect(() => {
    api
      .me()
      .then(() => setAuthState("authenticated"))
      .catch(() => setAuthState("anonymous"));
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setAuthState("anonymous");
  };

  if (authState === "checking") {
    return <div className="app-loading">PRIVATE SERVER</div>;
  }
  if (authState === "anonymous") {
    return <LoginScreen onSuccess={() => setAuthState("authenticated")} />;
  }

  return (
    <ProSpace onLogout={handleLogout} themePreference={themePreference} onChooseTheme={onChooseTheme} />
  );
}
