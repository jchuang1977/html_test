export async function copilotAuth(githubToken: string) {
  const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: { Accept: "application/json", Authorization: `Bearer ${githubToken}`, "User-Agent": "GitHubCopilotChat/0.35.0" },
  });
  if (!response.ok) throw new Error(`${response.status} Copilot authorization failed`);
  const data = await response.json() as { token?: string };
  if (!data.token) throw new Error("Copilot token missing");
  const proxyHost = /(?:^|;)proxy-ep=([^;]+)/.exec(data.token)?.[1];
  const host = proxyHost?.replace(/^proxy\./, "api.") || "api.individual.githubcopilot.com";
  if (!/^[a-z0-9.-]+\.githubcopilot\.com$/i.test(host)) throw new Error("Copilot endpoint invalid");
  return { apiKey: data.token, baseUrl: `https://${host}` };
}
