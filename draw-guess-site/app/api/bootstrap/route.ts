import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";

export const runtime = "edge";

export function modelCatalog() {
  const models = createModels();
  for (const factory of [openrouterProvider, githubCopilotProvider, openaiCodexProvider, openaiProvider, anthropicProvider, googleProvider]) {
    models.setProvider(factory());
  }
  return models;
}

export async function GET() {
  const models = modelCatalog();
  const providers = models.getProviders().map(provider => ({
    id: provider.id,
    name: provider.name,
    oauth: provider.id === "github-copilot"
      ? { label: "前往 GitHub 登入", subscription: true }
      : provider.id === "openrouter"
        ? { label: "前往 OpenRouter 登入", subscription: false }
        : provider.id === "openai-codex"
          ? { label: "了解申請方式", subscription: true, setupRequired: true }
          : null,
    connected: false,
    stored: false,
    authType: null,
    models: models.getModels(provider.id)
      .filter(model => model.input?.includes("image"))
      .map(model => ({ id: model.id, name: model.name || model.id })),
  })).filter(provider => provider.models.length);
  return Response.json({ providers }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
