export function contestForHash(contests, hash) {
    let id;
    try { id = decodeURIComponent(hash.replace(/^#/, '')); }
    catch { return contests[0]; }
    return contests.find(contest => String(contest.id) === id) || contests[0];
}

export function contestUrl(href, id) {
    const url = new URL(href);
    url.hash = encodeURIComponent(String(id));
    return url.href;
}
