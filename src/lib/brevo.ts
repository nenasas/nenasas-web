function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function normalizeEmail(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

export async function addSocio(email: string): Promise<void> {
  const listId = Number(requiredEnv("BREVO_SOCIOS_LIST_ID"));
  if (!Number.isInteger(listId)) throw new Error("BREVO_SOCIOS_LIST_ID is not an integer");

  const response = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      "api-key": requiredEnv("BREVO_API_KEY"),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      email,
      updateEnabled: true,
      listIds: [listId],
    }),
  });

  if (!response.ok) {
    console.error("Brevo contact update failed", response.status, await response.text());
    throw new Error("Brevo contact update failed");
  }
}
