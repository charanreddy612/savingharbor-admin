import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../config/api.js";

export default function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username, password }),
      });

      const jsonResponse = await res.json();

      if (!res.ok) {
        throw new Error(jsonResponse.message || "Login failed");
      }

      localStorage.setItem("authToken", jsonResponse.token);
      localStorage.setItem("username", jsonResponse.user.email);
      localStorage.setItem("userid", jsonResponse.user.id);
      localStorage.setItem("role_id", jsonResponse.user.role_id);

      const sidebarRes = await fetch(`${API_BASE_URL}/api/sidebar`, {
        headers: { Authorization: `Bearer ${jsonResponse.token}` },
      });

      if (!sidebarRes.ok) throw new Error("Failed to fetch sidebar");
      const menus = await sidebarRes.json();
      localStorage.setItem("sidebarMenus", JSON.stringify(menus));

      setLoading(false);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2">
      {/* LEFT — Welcome */}
      <div className="hidden md:flex flex-col justify-between px-16 py-20 bg-gradient-to-br from-indigo-600 to-indigo-800 text-white">
        <div>
          <h1 className="text-4xl font-bold mb-4">Welcome back 👋</h1>
          <p className="text-indigo-100 text-lg max-w-md">
            Manage merchants, coupons, seasons, and users from one central admin
            dashboard.
          </p>
        </div>

        <div className="mt-16 opacity-90">
          <div className="h-40 w-40 rounded-3xl bg-white/10 flex items-center justify-center text-6xl">
            🧞
          </div>
          <p className="mt-4 text-sm text-indigo-200">
            SavingHarbor Admin Panel
          </p>
        </div>

        <div className="text-xs text-indigo-300">
          Secure · Role-based · Audited
        </div>
      </div>

      {/* RIGHT — Login */}
      <div className="flex items-center justify-center px-6 bg-gray-50">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <div className="mb-8">
              <div className="mb-4 h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white text-xl font-bold">
                SH
              </div>
              <h2 className="text-2xl font-semibold text-gray-900">
                Admin Login
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Enter your credentials to continue
              </p>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  placeholder="admin@savingharbor.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 pr-10 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-xs text-gray-500 hover:text-gray-700"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-gray-600">
                  <input type="checkbox" className="rounded border-gray-300" />
                  Remember me
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500/30 disabled:bg-indigo-400 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading && (
                  <span className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                )}
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            © {new Date().getFullYear()} SavingHarbor
          </p>
        </div>
      </div>
    </div>
  );
}
