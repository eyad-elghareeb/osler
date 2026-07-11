const PUBLIC_INSTANCES = [
  "https://invidious.snopyta.org",
  "https://yewtu.be",
  "https://inv.nadeko.net",
  "https://invidious.projectsegfau.lt",
  "https://invidious.privacydev.net",
  "https://inv.vern.cc",
  "https://invidious.private.coffee",
];

let workingInstance: string | null = null;

async function findInstance(): Promise<string> {
  if (workingInstance) return workingInstance;
  const shuffled = [...PUBLIC_INSTANCES].sort(() => Math.random() - 0.5);
  for (const instance of shuffled) {
    try {
      const res = await fetch(`${instance}/api/v1/stats`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const reachable = new URL(instance);
        workingInstance = instance;
        return instance;
      }
    } catch {}
  }
  throw new Error("No Invidious instance available");
}

export async function getVideoStreamUrl(videoId: string): Promise<string | null> {
  try {
    const instance = await findInstance();
    const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.formatStreams?.length > 0) {
      const preferred = ["22", "18"];
      for (const itag of preferred) {
        const stream = data.formatStreams.find((s: { itag: string }) => s.itag === itag);
        if (stream?.url) return stream.url;
      }
      return data.formatStreams[0].url;
    }
    return null;
  } catch {
    return null;
  }
}
