import { PrismaClient } from "@prisma/client";

const base = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.SMOKE_ADMIN_EMAIL ?? "alice@example.com";
const password = process.env.SMOKE_ADMIN_PASSWORD ?? "password123";
const filename = `upload-smoke-${Date.now()}.txt`;
const prisma = new PrismaClient();
const results = [];

function record(name, passed, details = {}) {
  results.push({ name, passed, ...details });
}

try {
  const loginResponse = await fetch(`${base}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password }),
    redirect: "manual",
  });
  const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0] ?? "";
  record("Admin login produced session cookie", loginResponse.status === 302 && cookie.startsWith("session="), {
    status: loginResponse.status,
    location: loginResponse.headers.get("location"),
  });

  const form = new FormData();
  form.set("file", new Blob([Buffer.from("mvc boilerplate upload smoke test\n")], { type: "text/plain" }), filename);

  const uploadResponse = await fetch(`${base}/admin/assets/upload`, {
    method: "POST",
    headers: { cookie },
    body: form,
    redirect: "manual",
  });
  record("Asset upload endpoint accepts text file and redirects", uploadResponse.status === 302 && (uploadResponse.headers.get("location") ?? "").includes("/admin/assets"), {
    status: uploadResponse.status,
    location: uploadResponse.headers.get("location"),
  });

  const assetsPage = await fetch(`${base}/admin/assets`, { headers: { cookie } });
  const assetsHtml = await assetsPage.text();
  record("Uploaded file appears on media library page", assetsPage.status === 200 && assetsHtml.includes(filename), {
    status: assetsPage.status,
  });

  const asset = await prisma.asset.findFirst({
    where: { filename, deletedAt: null },
    select: { id: true, key: true, url: true, provider: true },
  });
  record("Uploaded asset metadata exists in database", Boolean(asset?.id), { asset });

  if (asset) {
    const deleteResponse = await fetch(`${base}/admin/assets/delete/${asset.id}`, {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    });
    record("Uploaded test asset cleanup succeeds", deleteResponse.status === 302, {
      status: deleteResponse.status,
      location: deleteResponse.headers.get("location"),
    });

    const deleted = await prisma.asset.findFirst({
      where: { id: asset.id },
      select: { deletedAt: true },
    });
    record("Uploaded test asset is soft-deleted", Boolean(deleted?.deletedAt), { deletedAt: deleted?.deletedAt });
  }
} finally {
  await prisma.$disconnect();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
