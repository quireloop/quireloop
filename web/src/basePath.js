// import.meta.env.BASE_URL is Vite's `base` config, always ending in '/'
// (defaults to '/'). Strip the trailing slash so callers can do
// `${BASE_PATH}/api/...` uniformly whether mounted at '/' or '/quireloop/'.
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
