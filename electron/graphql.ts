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

export async function signIn(
  endpoint: string,
  email: string,
  password: string,
) {
  return graphqlRequest<{ signIn: Omit<Session, "endpoint"> }>(
    endpoint,
    `
    mutation PosSignIn($email: String!, $password: String!) {
      signIn(email: $email, password: $password) {
        accessToken refreshToken accessTokenExpires
        user { id email role }
      }
    }
  `,
    { email, password },
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
        accessToken refreshToken accessTokenExpires
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
