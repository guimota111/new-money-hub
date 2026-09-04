import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z]/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
async function auth(id, secret) {
  const r = await fetch("https://api.pluggy.ai/auth", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: id, clientSecret: secret }),
  });
  return (await r.json()).apiKey;
}
const items = [
  ["Gui", await auth(env.PLUGGY_CLIENT_ID, env.PLUGGY_CLIENT_SECRET), "66334ebe-2d89-457b-916c-1dc35de64d83"],
];
for (const [who, key, item] of items) {
  const ar = await fetch(`https://api.pluggy.ai/accounts?itemId=${item}`, { headers: { "X-API-KEY": key } });
  const bank = ((await ar.json()).results ?? []).find((a) => a.type === "BANK");
  let path = `/v2/transactions?accountId=${bank.id}`;
  const cats = new Map();
  let guard = 0;
  while (path && guard++ < 30) {
    const r = await fetch(`https://api.pluggy.ai${path}`, { headers: { "X-API-KEY": key } });
    const data = await r.json();
    for (const t of data.results ?? []) {
      const k = `${t.type} | ${t.category ?? "(null)"}`;
      const e = cats.get(k) ?? { n: 0, total: 0, ex: [] };
      e.n++; e.total += Math.abs(t.amount);
      if (e.ex.length < 2) e.ex.push(`${t.date?.slice(0,10)} ${t.description?.slice(0, 45)} R$${Math.abs(t.amount)}`);
      cats.set(k, e);
    }
    path = data.next ? String(data.next).replace("https://api.pluggy.ai", "") : null;
    if (path && !path.startsWith("/")) path = `/v2/transactions${path.startsWith("?") ? path : "?" + path}`;
  }
  console.log(`=== ${who} — conta corrente, por tipo|categoria ===`);
  for (const [k, e] of [...cats.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`${String(e.n).padStart(4)}x R$${e.total.toFixed(0).padStart(9)}  ${k}`);
    for (const ex of e.ex) console.log(`        ${ex}`);
  }
}
