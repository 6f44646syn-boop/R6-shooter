# Recoil Range relay

A tiny Cloudflare Worker that lets Recoil Range network battles work over the internet
(including networks that block direct connections between PCs, like many school Wi-Fi
networks). Each game is a room with a short code; the relay only passes messages between the
host and the players.

The free Cloudflare Workers plan is enough for casual games.

## Deploy

    cd relay
    npm install
    npx wrangler login      # or set CLOUDFLARE_API_TOKEN
    npx wrangler deploy

Wrangler prints the address, e.g. `https://recoil-range-relay.<you>.workers.dev`. Put that
in the game (Battle > Network > Internet > Relay server), or in `js/net/relay.js` as
`DEFAULT_RELAY` so everyone gets it.

## Run locally

    npx wrangler dev --port 8787     # relay at http://127.0.0.1:8787
