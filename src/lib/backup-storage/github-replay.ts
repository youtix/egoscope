// A local replay of GitHub's REST API for one repository, for the tests of the GitHub
// backup adapter (github-releases.ts), which never reach GitHub: an HTTP layer in the
// shape of `fetch` that serves the recorded answers of data/fixtures/backup-storage/,
// each changed by what the request did to the release and its assets (backup storage
// sheet, "How it is called"). It records every request, and meets on demand the
// faults of a real service.
import assetRedirect from '@data/fixtures/backup-storage/asset-redirect.json';
import asset from '@data/fixtures/backup-storage/asset.json';
import errors from '@data/fixtures/backup-storage/errors.json';
import release from '@data/fixtures/backup-storage/release.json';
import repository from '@data/fixtures/backup-storage/repository.json';

/**
 * A recorded answer: its status, its headers and its body, served as its JSON text. An answer
 * with `text` is served as that string, byte for byte, ahead of `body`: it is how a body that is
 * no JSON, such as an HTML page, is recorded.
 */
type Recorded = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body?: unknown;
  text?: string;
}>;

/** A resource of the replay, whose next answer a script can replace. */
export type Route =
  'repository' | 'releases' | 'create' | 'assets' | 'upload' | 'delete' | 'asset' | 'file';

/** A fault that the next request of a route meets instead of its answer. */
export type Fault = Recorded | 'connection_lost' | 'body_cut';

/** A request that the replay received. */
export type Seen = Readonly<{ method: string; url: string; headers: Headers; body: Uint8Array }>;

/** How the repository starts: open to the given token, private unless said, and its next upload whole or broken off as a 502 can, leaving an empty asset in state `starter`. */
type ReplayOptions = Readonly<{
  acceptedToken: string;
  isPrivate?: boolean;
  isUploadBroken?: boolean;
}>;

type HeldRelease = Readonly<{ id: number; name: string; isDraft: boolean }>;
type HeldAsset = Readonly<{ id: number; name: string; state: string; bytes: Uint8Array }>;

/** The invented repository of every recorded answer. */
export const REPLAY_REPOSITORY = 'quiet-owner/archive-vault';
/** The host of the files that a download is redirected to. */
export const FILE_HOST = new URL(assetRedirect.headers.location).host;
/** The id of the first release or asset that the replay creates. */
export const FIRST_REPLAY_ID = 800_000_001;

const REPOSITORY_PATH = `/repos/${REPLAY_REPOSITORY}`;
const UPLOADS_HOST = 'uploads.github.com';
const DEFAULT_PAGE_SIZE = 100;
const NO_CONTENT = 204;
const ROUTES = new Map<string, Route>([
  ['GET ', 'repository'],
  ['GET /releases', 'releases'],
  ['POST /releases', 'create'],
]);

/** A recorded answer, with its body and some of its headers replaced. */
function replayed(
  recorded: Recorded,
  body: unknown = recorded.body,
  headers: Readonly<Record<string, string>> = {},
): Response {
  const text = recorded.text ?? (body === undefined ? null : JSON.stringify(body));
  return new Response(text, {
    status: recorded.status,
    headers: { ...recorded.headers, ...headers },
  });
}

/** An answer whose body breaks off before its end. */
function cutBody(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new TypeError('terminated'));
    },
  });
  return new Response(body, { headers: repository.headers });
}

function releaseOf(held: HeldRelease): Readonly<Record<string, unknown>> {
  return { ...release.body, id: held.id, name: held.name, draft: held.isDraft };
}

function assetOf(held: HeldAsset): Readonly<Record<string, unknown>> {
  return {
    ...asset.body,
    id: held.id,
    name: held.name,
    state: held.state,
    size: held.bytes.length,
  };
}

function routeOf(method: string, url: URL): Route {
  if (url.host === FILE_HOST) {
    return 'file';
  }
  if (url.host === UPLOADS_HOST) {
    return 'upload';
  }
  const path = url.pathname.slice(REPOSITORY_PATH.length);
  if (path.startsWith('/releases/assets/')) {
    return method === 'DELETE' ? 'delete' : 'asset';
  }
  return ROUTES.get(`${method} ${path}`) ?? 'assets';
}

const idOf = (url: URL): number => Number(url.pathname.slice(url.pathname.lastIndexOf('/') + 1));

/** GitHub's REST API for REPLAY_REPOSITORY, played from the recorded answers. */
export class GithubReplay {
  readonly #faults = new Map<Route, Fault>();
  readonly #releases: HeldRelease[] = [];
  readonly #isPrivate: boolean;
  #acceptedToken: string;
  #assets: readonly HeldAsset[] = [];
  #isUploadBroken: boolean;
  #nextId = FIRST_REPLAY_ID;
  #pageSize = DEFAULT_PAGE_SIZE;
  readonly #routes: Readonly<Record<Route, (url: URL, body: Uint8Array) => Response>> = {
    repository: () => replayed(repository, { ...repository.body, private: this.#isPrivate }),
    releases: (url) =>
      this.#page(
        url,
        this.#releases.map((held) => releaseOf(held)),
      ),
    create: () => replayed(release, releaseOf(this.addRelease('backups', true))),
    assets: (url) =>
      this.#page(
        url,
        this.#assets.map((held) => assetOf(held)),
      ),
    upload: (url, body) => this.#upload(String(url.searchParams.get('name')), body),
    delete: (url) => this.#delete(idOf(url)),
    asset: (url) => this.#redirect(idOf(url)),
    file: (url) => this.#file(idOf(url)),
  };

  /** Every request received since the last `forget`. */
  readonly requests: Seen[] = [];

  /** The HTTP layer, in the shape of `fetch`, that the adapter calls. */
  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const { method, url, headers } = request;
    const seen = { method, url, headers, body: new Uint8Array(await request.arrayBuffer()) };
    this.requests.push(seen);
    if (request.signal.aborted) {
      throw new DOMException('The call ended.', 'AbortError');
    }
    return this.#answer(seen);
  };

  /** A repository that lets in `acceptedToken` alone. */
  constructor(options: ReplayOptions) {
    this.#acceptedToken = options.acceptedToken;
    this.#isPrivate = options.isPrivate ?? true;
    this.#isUploadBroken = options.isUploadBroken ?? false;
  }

  #answer(seen: Seen): Response {
    const url = new URL(seen.url);
    const route = routeOf(seen.method, url);
    const fault = this.#faults.get(route);
    this.#faults.delete(route);
    if (fault === 'connection_lost') {
      throw new TypeError('fetch failed');
    }
    if (fault !== undefined) {
      return fault === 'body_cut' ? cutBody() : replayed(fault);
    }
    const isLetIn =
      route === 'file' || seen.headers.get('authorization') === `Bearer ${this.#acceptedToken}`;
    return isLetIn ? this.#routes[route](url, seen.body) : replayed(errors.bad_credentials);
  }

  #upload(name: string, bytes: Uint8Array): Response {
    if (this.#assets.some((held) => held.name === name)) {
      return replayed(errors.already_exists);
    }
    const isBroken = this.#isUploadBroken;
    this.#isUploadBroken = false;
    const held: HeldAsset = {
      id: this.#takeId(),
      name,
      state: isBroken ? 'starter' : 'uploaded',
      bytes: isBroken ? new Uint8Array() : bytes,
    };
    this.#assets = [...this.#assets, held];
    return isBroken ? replayed(errors.bad_gateway) : replayed(asset, assetOf(held));
  }

  #delete(id: number): Response {
    const isHeld = this.#assets.some((held) => held.id === id);
    this.#assets = this.#assets.filter((held) => held.id !== id);
    return isHeld ? new Response(null, { status: NO_CONTENT }) : replayed(errors.not_found);
  }

  #redirect(id: number): Response {
    const location = new URL(assetRedirect.headers.location);
    const folder = location.pathname.slice(0, location.pathname.lastIndexOf('/'));
    location.pathname = `${folder}/${String(id)}`;
    return this.#assets.some((held) => held.id === id)
      ? replayed(assetRedirect, undefined, { location: location.href })
      : replayed(errors.not_found);
  }

  #file(id: number): Response {
    const bytes = this.#assets.find((held) => held.id === id)?.bytes ?? new Uint8Array();
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-length': String(bytes.length) },
    });
  }

  /** One page of `items`, with a `Link` to the next when there is one. */
  #page(url: URL, items: readonly unknown[]): Response {
    const page = Number(url.searchParams.get('page') ?? '1');
    const start = (page - 1) * this.#pageSize;
    const next = new URL(url);
    next.searchParams.set('page', String(page + 1));
    const link =
      start + this.#pageSize < items.length ? { link: `<${next.href}>; rel="next"` } : {};
    const recorded = { status: repository.status, headers: repository.headers };
    return replayed(recorded, items.slice(start, start + this.#pageSize), link);
  }

  #takeId(): number {
    const id = this.#nextId;
    this.#nextId += 1;
    return id;
  }

  /** The next request of `route` meets `fault` instead of its answer. */
  script(route: Route, fault: Fault): void {
    this.#faults.set(route, fault);
  }

  /** Adds a release, a draft or a published one, as the owner may have made it. */
  addRelease(name: string, isDraft: boolean): HeldRelease {
    const held = { id: this.#takeId(), name, isDraft };
    this.#releases.push(held);
    return held;
  }

  /** From now on, the repository lets in `token` alone, as after a token was revoked. */
  acceptOnly(token: string): void {
    this.#acceptedToken = token;
  }

  /** From now on, each listing page holds at most `size` items. */
  setPageSize(size: number): void {
    this.#pageSize = size;
  }

  /** Forgets the requests received so far. */
  forget(): void {
    this.requests.length = 0;
  }
}
