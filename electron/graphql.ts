import type { Session } from "./session";

type GraphqlResponse<T> = { data?: T; errors?: Array<{ message: string }> };

export function normalizeEndpoint(value: string) {
  const url = new URL(value.trim());
  if (!/^https?:$/.test(url.protocol))
    throw new Error("Server URL must use HTTP or HTTPS");
  if (!url.pathname || url.pathname === "/") url.pathname = "/graphql";
  return url.toString().replace(/\/$/, "");
}

export async function graphqlRequest<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
  accessToken?: string,
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response
    .json()
    .catch(() => null)) as GraphqlResponse<T> | null;
  if (!response.ok || body?.errors?.length)
    throw new Error(
      body?.errors?.[0]?.message ?? `Server returned ${response.status}`,
    );
  if (!body?.data) throw new Error("Server returned no data");
  return body.data;
}

export async function uploadGraphqlFile(
  endpoint: string,
  input: { bytes: Buffer; filename: string; mimeType: string },
  accessToken: string,
) {
  const form = new FormData();
  form.append("operations", JSON.stringify({
    query: "mutation UploadPosCatalogImage($file: File!) { uploadFile(file: $file) { url } }",
    variables: { file: null },
  }));
  form.append("map", JSON.stringify({ "0": ["variables.file"] }));
  form.append("0", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.filename);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as GraphqlResponse<{ uploadFile: { url: string } }> | null;
  if (!response.ok || body?.errors?.length || !body?.data?.uploadFile?.url)
    throw new Error(body?.errors?.[0]?.message ?? `Image upload failed (${response.status})`);
  return body.data.uploadFile.url;
}

export async function signIn(
  endpoint: string,
  email: string,
  password: string,
  device: { deviceKey: string; deviceName: string; platform: string; appVersion: string },
) {
  return graphqlRequest<{ signIn: Omit<Session, "endpoint"> }>(
    endpoint,
    `
    mutation PosSignIn($email: String!, $password: String!, $deviceKey: String, $deviceName: String, $platform: String, $appVersion: String) {
      signIn(email: $email, password: $password, deviceKey: $deviceKey, deviceName: $deviceName, platform: $platform, appVersion: $appVersion) {
        accessToken refreshToken tokenId accessTokenExpires
        user { id email role }
      }
    }
  `,
    { email, password, ...device },
  );
}

export async function refreshSession(session: Session): Promise<Session> {
  const data = await graphqlRequest<{
    refreshToken: Omit<Session, "endpoint">;
  }>(
    session.endpoint,
    `
    mutation RefreshPosSession($token: String!) {
      refreshToken(data: $token) {
        accessToken refreshToken tokenId accessTokenExpires
        user { id email role }
      }
    }
  `,
    { token: session.refreshToken },
  );
  return {
    endpoint: session.endpoint,
    offlineUntil: session.offlineUntil,
    lastTrustedAt: session.lastTrustedAt,
    ...data.refreshToken,
  };
}

export type AccountSession = {
  id: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export async function listAccountSessions(session: Session) {
  return graphqlRequest<{ mySessions: AccountSession[] }>(session.endpoint, `query PosAccountSessions { mySessions { id deviceName platform appVersion ipAddress userAgent createdAt lastSeenAt expiresAt } }`, {}, session.accessToken);
}

export async function revokeAccountSession(session: Session, tokenId: string) {
  return graphqlRequest<{ revokeSession: boolean }>(session.endpoint, `mutation RevokePosSession($tokenId: String!) { revokeSession(tokenId: $tokenId) }`, { tokenId }, session.accessToken);
}

export async function revokeOtherAccountSessions(session: Session) {
  if (!session.tokenId) throw new Error("SESSION_UPGRADE_REQUIRED");
  return graphqlRequest<{ revokeOtherSessions: boolean }>(session.endpoint, `mutation RevokeOtherPosSessions($currentTokenId: String!) { revokeOtherSessions(currentTokenId: $currentTokenId) }`, { currentTokenId: session.tokenId }, session.accessToken);
}

export async function logoutAccountSession(session: Session) {
  if (!session.tokenId) throw new Error("SESSION_UPGRADE_REQUIRED");
  return graphqlRequest<{ logout: boolean }>(session.endpoint, `mutation LogoutPosSession($tokenId: String) { logout(tokenId: $tokenId) }`, { tokenId: session.tokenId }, session.accessToken);
}
