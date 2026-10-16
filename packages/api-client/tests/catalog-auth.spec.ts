import { HttpClient } from '../src/http-client';
import { MemoryTokenStore } from '../src/token-store';
import { CatalogResource } from '../src/resources/catalog';

describe('branch menu authentication', () => {
  it.each([true, false])('loads the menu with staff session=%s', async (signedIn) => {
    const tokenStore = new MemoryTokenStore();
    if (signedIn) tokenStore.set({ accessToken: 'staff-jwt', refreshToken: 'refresh', expiresAt: Date.now() + 60_000 });
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const http = new HttpClient({
      baseUrl: 'https://pos.example.test/api/v1', tokenStore,
      fetchImpl: (async (input, init) => {
        requests.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
        return new Response(JSON.stringify({ success: true, data: { branchId: 'branch-1', categories: [] } }), { status: 200 });
      }) as typeof fetch,
    });
    await new CatalogResource(http).branchMenu('branch-1');
    expect(requests).toEqual([{ url: 'https://pos.example.test/api/v1/menu/branch-1', authorization: signedIn ? 'Bearer staff-jwt' : null }]);
  });
});
