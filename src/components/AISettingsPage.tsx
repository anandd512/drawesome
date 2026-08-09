import { useState } from "react";
import {
  clearAISettings,
  hasAISettings,
  loadAISettings,
  saveAISettings,
  testAIConnection,
} from "../lib/ai";

interface AISettingsPageProps {
  onBack: () => void;
  onConnectionChange: (connected: boolean) => void;
}

export default function AISettingsPage({ onBack, onConnectionChange }: AISettingsPageProps) {
  const [settings, setSettings] = useState(loadAISettings);
  const [connected, setConnected] = useState(hasAISettings);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const nextSettings = {
      model: settings.model.trim(),
      endpoint: settings.endpoint.trim(),
      apiKey: settings.apiKey.trim(),
    };
    const isConnected = Boolean(nextSettings.model && nextSettings.endpoint && nextSettings.apiKey);
    saveAISettings(nextSettings);
    setConnected(isConnected);
    onConnectionChange(isConnected);
    setSaved(true);
    setTestResult(null);
  };

  const disconnect = () => {
    clearAISettings();
    setSettings({ model: "", endpoint: "", apiKey: "" });
    setConnected(false);
    setSaved(false);
    setTestResult(null);
    onConnectionChange(false);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const reply = await testAIConnection(settings);
      setTestResult({ ok: true, message: `Connection successful. Model replied: ${reply}` });
    } catch (reason) {
      setTestResult({
        ok: false,
        message: reason instanceof Error ? reason.message : "Could not connect to the model endpoint.",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f8fa] px-5 py-8 text-gray-900">
      <div className="mx-auto max-w-4xl">
        <button onClick={onBack} className="mb-8 rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-200/70 hover:text-gray-900">
          ← Canvas
        </button>
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">Model integration</p>
            <h1 className="text-3xl font-semibold tracking-normal">AI connection</h1>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Connect an OpenAI-compatible endpoint to reveal AI tools on the canvas. Drawesome works fully without this integration.
            </p>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${connected ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-600"}`}>
            {connected ? "Connected" : "Not connected"}
          </span>
        </header>

        <div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_240px]">
        <form onSubmit={save} className="space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Model name</span>
            <input
              required
              value={settings.model}
              onChange={(event) => setSettings({ ...settings, model: event.target.value })}
              placeholder="gpt-4.1"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2.5 outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-200"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Model endpoint</span>
            <input
              required
              type="url"
              value={settings.endpoint}
              onChange={(event) => setSettings({ ...settings, endpoint: event.target.value })}
              placeholder="https://api.openai.com/v1/chat/completions"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2.5 outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-200"
            />
            <span className="mt-2 block text-xs text-gray-500">
              Use a URL ending in /responses or /chat/completions. For Azure OpenAI, include the deployment path and api-version query string.
            </span>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">API key</span>
            <div className="flex gap-2">
              <input
                required
                type={showKey ? "text" : "password"}
                value={settings.apiKey}
                onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
                placeholder="Enter API key"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2.5 outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-200"
              />
              <button
                type="button"
                onClick={() => setShowKey((visible) => !visible)}
                className="rounded-md border border-gray-300 bg-white px-3 text-sm font-medium hover:bg-gray-100"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-6">
            <button type="submit" className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800">
              Save connection
            </button>
            <button
              type="button"
              disabled={testing}
              onClick={testConnection}
              className="rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testing ? "Testing..." : "Test connection"}
            </button>
            {saved && <span className="text-sm font-medium text-green-700">Settings saved</span>}
            {connected && (
              <button type="button" onClick={disconnect} className="ml-auto text-sm font-medium text-red-600 hover:text-red-800">
                Disconnect
              </button>
            )}
          </div>
          {testResult && (
            <div
              role="status"
              className={`rounded-lg border p-3 text-sm leading-5 ${
                testResult.ok
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {testResult.message}
            </div>
          )}
        </form>
        <aside className="border-t border-gray-200 pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
          <h2 className="text-sm font-semibold text-gray-900">Before connecting</h2>
          <ul className="mt-3 space-y-3 text-sm leading-5 text-gray-600">
            <li>The key stays in local storage on this device.</li>
            <li>Use a restricted key on a private computer.</li>
            <li>The endpoint must allow browser CORS requests.</li>
            <li>Image import requires a vision-capable model.</li>
          </ul>
        </aside>
        </div>
      </div>
    </main>
  );
}