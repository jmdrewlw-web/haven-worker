# Haven Site Intelligence — Cloudflare Worker

## Quick Deploy (10 minutes)

### 1. Install Wrangler (if not already)
```bash
npm install -g wrangler
```

### 2. Login to Cloudflare
```bash
wrangler login
```

### 3. Deploy
```bash
cd haven-worker
wrangler deploy
```

### 4. Test
```bash
curl https://haven-intel.<your-subdomain>.workers.dev/health
curl https://haven-intel.<your-subdomain>.workers.dev/api/davidson/parcels?address=4012+Hillsboro+Pike
curl https://haven-intel.<your-subdomain>.workers.dev/api/dallas/parcels?address=4800+W+Lovers+Ln+Dallas+TX
curl https://haven-intel.<your-subdomain>.workers.dev/api/site-brief?address=4012+Hillsboro+Pike&county=davidson
```

## Endpoints

### Davidson County (Nashville, TN)
| Endpoint | Params | Description |
|----------|--------|-------------|
| `/api/davidson/parcels` | `address` | Parcel data: owner, zoning, assessed value, acres, last sale |
| `/api/davidson/permits` | `address` | Issued building permits with costs and dates |
| `/api/davidson/permit-apps` | `address` | Pending permit applications |
| `/api/davidson/planning` | `keyword` | Planning department development applications |
| `/api/davidson/legistar` | `keyword` | Zoning bills, legislation, council matters |

### Montgomery County (Clarksville, TN)
| Endpoint | Params | Description |
|----------|--------|-------------|
| `/api/montgomery/parcels` | `address` | Parcel data: owner, zoning, value, building details |
| `/api/montgomery/zoning` | `lat`, `lng` | Zoning district at coordinates |

### Dallas County (DFW, TX)
| Endpoint | Params | Description |
|----------|--------|-------------|
| `/api/dallas/parcels` | `address` | DCAD parcel data: owner, land/improvement/assessed values, use description |
| `/api/dallas/permits` | `address` | City of Dallas building permits with type, cost, and description |
| `/api/dallas/legistar` | `keyword` | Dallas City Council legislative matters |

### Composite
| Endpoint | Params | Description |
|----------|--------|-------------|
| `/api/site-brief` | `address`, `county` | **All sources in one call, scored 1–10** |

## Cost
**$0/month** on Cloudflare free tier (100K requests/day)
