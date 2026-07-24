export function supabaseServiceHeaders(key, headers = {}) {
  const requestHeaders = {
    ...headers,
    apikey: key,
  };

  if (!key.startsWith("sb_secret_")) {
    requestHeaders.Authorization = `Bearer ${key}`;
  }

  return requestHeaders;
}
