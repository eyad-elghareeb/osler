import { createSerwistRoute } from "@serwist/turbopack";

const route = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
});

export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

export async function generateStaticParams() {
  const params = await route.generateStaticParams();
  return params.map((p) => ({ path: Array.isArray(p.path) ? p.path : [p.path] }));
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ path: string | string[] }> }
) {
  const resolved = await ctx.params;
  const path = Array.isArray(resolved.path) ? resolved.path.join("/") : resolved.path;
  return route.GET(request, { params: Promise.resolve({ path }) });
}
