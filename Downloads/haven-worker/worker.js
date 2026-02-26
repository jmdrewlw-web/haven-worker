/**
 * HAVEN SITE INTELLIGENCE — Cloudflare Worker
 * Proxies Nashville metro API calls, adds CORS, caches responses
 * Deploy: wrangler deploy
 */

const CACHE_TTL = {
  parcels: 3600,      // 1 hour
  permits: 300,       // 5 minutes
  legistar: 1800,     // 30 minutes
  zoning: 86400,      // 24 hours
  montgomery: 3600,   // 1 hour
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// API ENDPOINTS
const APIS = {
  // Davidson County (Nashville)
  davidson_parcels: 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/ArcGIS/rest/services/Parcels_with_Zoning_view/FeatureServer/0/query',
  davidson_permits: 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/ArcGIS/rest/services/Building_Permits_Issued_2/FeatureServer/0/query',
  davidson_permit_apps: 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/ArcGIS/rest/services/Building_Permit_Applications_Feature_Layer_view/FeatureServer/0/query',
  davidson_planning: 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/ArcGIS/rest/services/PlanningDepartmentDevelopmentApplications_view/FeatureServer/0/query',
  legistar: 'https://webapi.legistar.com/v1/nashville',
  
  // Montgomery County (Clarksville)
  montgomery_parcels: 'https://gis.mcgtn.org/arcgis/rest/services/Parcels/MapServer/0/query',
  montgomery_zoning: 'https://gis.mcgtn.org/arcgis/rest/services/Zoning/MapServer/0/query',
  montgomery_energov: 'https://gis.mcgtn.org/arcgis/rest/services/Energov/MapServer',

  // Dallas County (DFW)
  dcad_parcels: 'https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4/query',
  dallas_permits: 'https://www.dallasopendata.com/resource/e7gq-4sah.json',
  dallas_legistar: 'https://webapi.legistar.com/v1/cityofdallas',
};

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/' || path === '/health') {
      return jsonResponse({ 
        status: 'ok', 
        service: 'Haven Site Intelligence API',
        version: '1.0.0',
        counties: ['davidson', 'montgomery', 'dallas'],
        endpoints: [
          '/api/davidson/parcels?address=...',
          '/api/davidson/permits?address=...',
          '/api/davidson/permit-apps?address=...',
          '/api/davidson/planning?keyword=...',
          '/api/davidson/legistar?keyword=...',
          '/api/montgomery/parcels?address=...',
          '/api/montgomery/zoning?lat=...&lng=...',
          '/api/dallas/parcels?address=...',
          '/api/dallas/permits?address=...',
          '/api/dallas/legistar?keyword=...',
          '/api/site-brief?address=...&county=davidson',
        ]
      });
    }

    try {
      // Route to handlers
      if (path.startsWith('/api/davidson/parcels')) return await handleDavidsonParcels(url, ctx);
      if (path.startsWith('/api/davidson/permits-pending') || path.startsWith('/api/davidson/permit-apps')) return await handleDavidsonPermitApps(url, ctx);
      if (path.startsWith('/api/davidson/permits')) return await handleDavidsonPermits(url, ctx);
      if (path.startsWith('/api/davidson/planning')) return await handleDavidsonPlanning(url, ctx);
      if (path.startsWith('/api/davidson/legistar') || path.startsWith('/api/legistar')) return await handleLegistar(url, ctx);
      if (path.startsWith('/api/montgomery/parcels')) return await handleMontgomeryParcels(url, ctx);
      if (path.startsWith('/api/montgomery/zoning')) return await handleMontgomeryZoning(url, ctx);
      if (path.startsWith('/api/dallas/parcels')) return await handleDallasParcels(url, ctx);
      if (path.startsWith('/api/dallas/permits')) return await handleDallasPermits(url, ctx);
      if (path.startsWith('/api/dallas/legistar')) return await handleDallasLegistar(url, ctx);
      if (path.startsWith('/api/site-brief')) return await handleSiteBrief(url, ctx);

      return jsonResponse({ error: 'Not found', available: '/health for endpoints' }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }
};

// ============================================
// DAVIDSON COUNTY HANDLERS
// ============================================

async function handleDavidsonParcels(url, ctx) {
  const address = url.searchParams.get('address') || '';
  if (!address) return jsonResponse({ error: 'address parameter required' }, 400);

  // Try exact match first, then fuzzy
  const streetParts = parseAddress(address);
  let where;
  if (streetParts.number && streetParts.street) {
    where = `PropAddr LIKE '%${streetParts.number}%${streetParts.street}%'`;
  } else {
    where = `PropAddr LIKE '%${sanitize(address)}%'`;
  }

  const params = new URLSearchParams({
    where: where,
    outFields: 'PropAddr,PropStreet,PropZip,Owner,OwnDate,SalePrice,ZoneCode,LUDesc,TotlAppr,LandAppr,ImprAppr,Acres,Council,APN,LegalDesc',
    resultRecordCount: '10',
    f: 'json'
  });

  return await cachedFetch(`${APIS.davidson_parcels}?${params}`, 'parcels', ctx);
}

async function handleDavidsonPermits(url, ctx) {
  const address = url.searchParams.get('address') || '';
  if (!address) return jsonResponse({ error: 'address parameter required' }, 400);

  const streetParts = parseAddress(address);
  let where;
  if (streetParts.number) {
    where = `ADDRESS LIKE '%${streetParts.number}%${streetParts.street}%'`;
  } else {
    where = `ADDRESS LIKE '%${sanitize(address)}%'`;
  }

  const params = new URLSearchParams({
    where: where,
    outFields: '*',
    resultRecordCount: '20',
    orderByFields: 'DATE_ISSUED DESC',
    f: 'json'
  });

  return await cachedFetch(`${APIS.davidson_permits}?${params}`, 'permits', ctx);
}

async function handleDavidsonPermitApps(url, ctx) {
  const address = url.searchParams.get('address') || '';
  if (!address) return jsonResponse({ error: 'address parameter required' }, 400);

  const streetParts = parseAddress(address);
  let where;
  if (streetParts.number) {
    where = `ADDRESS LIKE '%${streetParts.number}%${streetParts.street}%'`;
  } else {
    where = `ADDRESS LIKE '%${sanitize(address)}%'`;
  }

  const params = new URLSearchParams({
    where: where,
    outFields: '*',
    resultRecordCount: '20',
    f: 'json'
  });

  return await cachedFetch(`${APIS.davidson_permit_apps}?${params}`, 'permits', ctx);
}

async function handleDavidsonPlanning(url, ctx) {
  const keyword = url.searchParams.get('keyword') || url.searchParams.get('address') || '';
  if (!keyword) return jsonResponse({ error: 'keyword or address parameter required' }, 400);

  const streetParts = parseAddress(keyword);
  const searchTerm = streetParts.street || sanitize(keyword);

  const params = new URLSearchParams({
    where: `Case_Address LIKE '%${searchTerm}%' OR Case_Description LIKE '%${searchTerm}%'`,
    outFields: '*',
    resultRecordCount: '20',
    f: 'json'
  });

  return await cachedFetch(`${APIS.davidson_planning}?${params}`, 'permits', ctx);
}

async function handleLegistar(url, ctx) {
  const keyword = url.searchParams.get('keyword') || url.searchParams.get('address') || '';
  if (!keyword) return jsonResponse({ error: 'keyword or address parameter required' }, 400);

  const searchTerm = sanitize(keyword);
  
  // Search matters (legislation) mentioning this keyword
  const apiUrl = `${APIS.legistar}/matters?$filter=substringof('${searchTerm}',MatterTitle)&$top=20&$orderby=MatterIntroDate desc`;
  
  return await cachedFetch(apiUrl, 'legistar', ctx);
}

// ============================================
// MONTGOMERY COUNTY HANDLERS
// ============================================

async function handleMontgomeryParcels(url, ctx) {
  const address = url.searchParams.get('address') || '';
  if (!address) return jsonResponse({ error: 'address parameter required' }, 400);

  const streetParts = parseAddress(address);
  let where;
  if (streetParts.number && streetParts.street) {
    where = `PropertyAddress LIKE '%${streetParts.number}%${streetParts.street}%'`;
  } else {
    where = `PropertyAddress LIKE '%${sanitize(address)}%'`;
  }

  const params = new URLSearchParams({
    where: where,
    outFields: 'Owner1,Owner2,PropertyAddress,PropertyCity,Zoning,ZoningDesc,LandUseDesc,PropertyTypeDesc,CalcAcreage,DeedAcreage,MktAppraisedValue,AppraisedValue,AssessedValue,MktLandValue,BuildingValue,SalesDate,SalesPrice,Grantor,Grantee,YearBuilt,LivingArea,TotalAdjArea,Neighborhood',
    returnGeometry: 'false',
    f: 'json'
  });

  return await cachedFetch(`${APIS.montgomery_parcels}?${params}`, 'montgomery', ctx);
}

async function handleMontgomeryZoning(url, ctx) {
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  
  if (!lat || !lng) return jsonResponse({ error: 'lat and lng parameters required' }, 400);

  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    f: 'json'
  });

  return await cachedFetch(`${APIS.montgomery_zoning}?${params}`, 'zoning', ctx);
}

// ============================================
// DALLAS COUNTY HANDLERS (DFW)
// ============================================

async function handleDallasParcels(url, ctx) {
  const address = url.searchParams.get('address') || '';
  if (!address) return jsonResponse({ error: 'address parameter required' }, 400);

  const parts = parseAddress(address);
  let where;
  if (parts.number && parts.street) {
    where = `SITEADDRESS LIKE '%${parts.number}%${parts.street}%'`;
  } else {
    where = `SITEADDRESS LIKE '%${sanitize(address)}%'`;
  }

  const params = new URLSearchParams({
    where: where,
    outFields: 'SITEADDRESS,OWNERNME1,USEDSCRP,BLDGAREA,LNDVALUE,IMPVALUE,CNTASSDVAL',
    resultRecordCount: '10',
    f: 'json'
  });

  return await cachedFetch(`${APIS.dcad_parcels}?${params}`, 'parcels', ctx);
}

async function handleDallasPermits(url, ctx) {
  const address = url.searchParams.get('address') || '';
  if (!address) return jsonResponse({ error: 'address parameter required' }, 400);

  const parts = parseAddress(address);
  const searchAddr = parts.number
    ? `${parts.number} ${parts.street}`
    : sanitize(address);

  const params = new URLSearchParams({
    '$where': `upper(street_address) LIKE '%${searchAddr.toUpperCase()}%'`,
    '$order': 'issued_date DESC',
    '$limit': '20'
  });

  try {
    const resp = await fetch(`${APIS.dallas_permits}?${params}`);
    const rows = await resp.json();
    // Normalize Socrata response to ArcGIS-like features format
    const features = (Array.isArray(rows) ? rows : []).map(r => ({
      attributes: {
        Permit__: r.permit_number || '—',
        Permit_Type_Description: r.permit_type || '—',
        Date_Issued: r.issued_date ? new Date(r.issued_date).getTime() : null,
        Const_Cost: r.value ? Number(r.value) : 0,
        Purpose: r.work_description || '',
        Status: r.status || 'Issued',
      }
    }));
    return jsonResponse({ features });
  } catch (err) {
    return jsonResponse({ error: err.message }, 502);
  }
}

async function handleDallasLegistar(url, ctx) {
  const keyword = url.searchParams.get('keyword') || url.searchParams.get('address') || '';
  if (!keyword) return jsonResponse({ error: 'keyword or address parameter required' }, 400);

  const searchTerm = sanitize(keyword);
  const apiUrl = `${APIS.dallas_legistar}/matters?$filter=substringof('${searchTerm}',MatterTitle)&$top=20&$orderby=MatterIntroDate desc`;

  return await cachedFetch(apiUrl, 'legistar', ctx);
}

// ============================================
// COMPOSITE: SITE BRIEF
// ============================================

async function handleSiteBrief(url, ctx) {
  const address = url.searchParams.get('address') || '';
  const county = (url.searchParams.get('county') || 'davidson').toLowerCase();
  
  if (!address) return jsonResponse({ error: 'address parameter required' }, 400);

  const brief = {
    address: address,
    county: county,
    timestamp: new Date().toISOString(),
    data: {}
  };

  if (county === 'davidson') {
    // Parallel fetch all Davidson sources
    const streetParts = parseAddress(address);
    const searchTerm = streetParts.street || sanitize(address);

    const [parcels, permits, permitApps, planning, legistar] = await Promise.allSettled([
      fetchJSON(buildDavidsonParcelUrl(address)),
      fetchJSON(buildDavidsonPermitUrl(address)),
      fetchJSON(buildDavidsonPermitAppUrl(address)),
      fetchJSON(buildDavidsonPlanningUrl(searchTerm)),
      fetchJSON(buildLegistarUrl(searchTerm)),
    ]);

    brief.data.parcels = parcels.status === 'fulfilled' ? parcels.value : { error: parcels.reason?.message };
    brief.data.permits = permits.status === 'fulfilled' ? permits.value : { error: permits.reason?.message };
    brief.data.permitApplications = permitApps.status === 'fulfilled' ? permitApps.value : { error: permitApps.reason?.message };
    brief.data.planning = planning.status === 'fulfilled' ? planning.value : { error: planning.reason?.message };
    brief.data.legistar = legistar.status === 'fulfilled' ? legistar.value : { error: legistar.reason?.message };

    // Compute signal score
    brief.signalScore = computeSignalScore(brief.data);

  } else if (county === 'montgomery') {
    const [parcels] = await Promise.allSettled([
      fetchJSON(buildMontgomeryParcelUrl(address)),
    ]);

    brief.data.parcels = parcels.status === 'fulfilled' ? parcels.value : { error: parcels.reason?.message };
    brief.signalScore = computeSignalScoreMontgomery(brief.data);
  }

  return jsonResponse(brief);
}

// ============================================
// URL BUILDERS FOR SITE BRIEF
// ============================================

function buildDavidsonParcelUrl(address) {
  const parts = parseAddress(address);
  const where = parts.number && parts.street 
    ? `PropAddr LIKE '%${parts.number}%${parts.street}%'`
    : `PropAddr LIKE '%${sanitize(address)}%'`;
  return `${APIS.davidson_parcels}?where=${encodeURIComponent(where)}&outFields=PropAddr,PropStreet,PropZip,Owner,OwnDate,SalePrice,ZoneCode,LUDesc,TotlAppr,LandAppr,ImprAppr,Acres,Council,APN,LegalDesc&resultRecordCount=5&f=json`;
}

function buildDavidsonPermitUrl(address) {
  const parts = parseAddress(address);
  const where = parts.number 
    ? `ADDRESS LIKE '%${parts.number}%${parts.street}%'`
    : `ADDRESS LIKE '%${sanitize(address)}%'`;
  return `${APIS.davidson_permits}?where=${encodeURIComponent(where)}&outFields=*&resultRecordCount=20&orderByFields=${encodeURIComponent('DATE_ISSUED DESC')}&f=json`;
}

function buildDavidsonPermitAppUrl(address) {
  const parts = parseAddress(address);
  const where = parts.number
    ? `ADDRESS LIKE '%${parts.number}%${parts.street}%'`
    : `ADDRESS LIKE '%${sanitize(address)}%'`;
  return `${APIS.davidson_permit_apps}?where=${encodeURIComponent(where)}&outFields=*&resultRecordCount=20&f=json`;
}

function buildDavidsonPlanningUrl(keyword) {
  const where = `Case_Address LIKE '%${sanitize(keyword)}%' OR Case_Description LIKE '%${sanitize(keyword)}%'`;
  return `${APIS.davidson_planning}?where=${encodeURIComponent(where)}&outFields=*&resultRecordCount=20&f=json`;
}

function buildLegistarUrl(keyword) {
  return `${APIS.legistar}/matters?$filter=substringof('${sanitize(keyword)}',MatterTitle)&$top=20&$orderby=MatterIntroDate desc`;
}

function buildMontgomeryParcelUrl(address) {
  const parts = parseAddress(address);
  const where = parts.number && parts.street
    ? `PropertyAddress LIKE '%${parts.number}%${parts.street}%'`
    : `PropertyAddress LIKE '%${sanitize(address)}%'`;
  return `${APIS.montgomery_parcels}?where=${encodeURIComponent(where)}&outFields=Owner1,Owner2,PropertyAddress,PropertyCity,Zoning,ZoningDesc,LandUseDesc,PropertyTypeDesc,CalcAcreage,DeedAcreage,MktAppraisedValue,AppraisedValue,AssessedValue,MktLandValue,BuildingValue,SalesDate,SalesPrice,Grantor,Grantee,YearBuilt,LivingArea,TotalAdjArea,Neighborhood&returnGeometry=false&f=json`;
}

// ============================================
// SIGNAL SCORING
// ============================================

function computeSignalScore(data) {
  let score = 1;
  const factors = [];

  // Parcel data exists
  const parcels = data.parcels?.features || [];
  if (parcels.length > 0) {
    score += 1;
    factors.push('Property identified in database');
    
    const parcel = parcels[0]?.attributes || {};
    const zone = (parcel.ZoneCode || '').toUpperCase();
    const landUse = (parcel.LUDesc || '').toUpperCase();
    
    // Commercial zoning
    if (zone.match(/^(CS|CL|CF|CC|SCR|MUL|MUN|MUG|OR|OL|OG|IWD|IG|IR)/)) {
      score += 1;
      factors.push(`Commercial zoning: ${zone}`);
    }
    
    // Recent sale (within 2 years)
    if (parcel.SalePrice && parcel.SalePrice > 0) {
      score += 1;
      factors.push(`Recent sale: $${parcel.SalePrice.toLocaleString()}`);
    }
  }

  // Permit activity
  const permits = data.permits?.features || [];
  if (permits.length > 0) {
    score += 1;
    factors.push(`${permits.length} permit(s) found`);
    
    // High-value permits
    const highValue = permits.filter(p => (p.attributes?.CONST_COST || 0) > 500000);
    if (highValue.length > 0) {
      score += 1;
      factors.push(`${highValue.length} high-value permit(s) >$500K`);
    }
  }

  // Pending permit applications
  const apps = data.permitApplications?.features || [];
  if (apps.length > 0) {
    score += 1;
    factors.push(`${apps.length} pending permit application(s)`);
  }

  // Planning cases
  const planning = data.planning?.features || [];
  if (planning.length > 0) {
    score += 1;
    factors.push(`${planning.length} planning case(s)`);
  }

  // Legistar (zoning bills)
  const matters = Array.isArray(data.legistar) ? data.legistar : [];
  if (matters.length > 0) {
    score += 1;
    factors.push(`${matters.length} legislative matter(s)`);
    
    // Active zoning changes
    const active = matters.filter(m => {
      const status = (m.MatterStatusName || '').toLowerCase();
      return status.includes('hearing') || status.includes('committee') || status.includes('filed');
    });
    if (active.length > 0) {
      score += 1;
      factors.push(`${active.length} ACTIVE zoning matter(s)`);
    }
  }

  return {
    score: Math.min(score, 10),
    maxScore: 10,
    label: score >= 8 ? 'HOT' : score >= 6 ? 'WARM' : score >= 4 ? 'MODERATE' : 'COOL',
    factors: factors
  };
}

function computeSignalScoreMontgomery(data) {
  let score = 1;
  const factors = [];

  const parcels = data.parcels?.features || [];
  if (parcels.length > 0) {
    score += 2;
    factors.push('Property identified');
    
    const p = parcels[0]?.attributes || {};
    if (p.Zoning && !p.Zoning.match(/^R/i)) {
      score += 2;
      factors.push(`Commercial zoning: ${p.Zoning}`);
    }
    if (p.SalesPrice && parseInt(p.SalesPrice) > 0) {
      score += 1;
      factors.push(`Sale recorded: $${parseInt(p.SalesPrice).toLocaleString()}`);
    }
  }

  return {
    score: Math.min(score, 10),
    maxScore: 10,
    label: score >= 8 ? 'HOT' : score >= 6 ? 'WARM' : score >= 4 ? 'MODERATE' : 'COOL',
    factors: factors,
    note: 'Limited to parcel data. Legislation monitoring available for Davidson County.'
  };
}

// ============================================
// UTILITIES
// ============================================

function parseAddress(addr) {
  const clean = addr.trim().toUpperCase();
  const match = clean.match(/^(\d+)\s+(.+)/);
  if (match) {
    let street = match[2]
      .replace(/\b(STREET|ST)\b\.?$/i, 'ST')
      .replace(/\b(AVENUE|AVE)\b\.?$/i, 'AVE')
      .replace(/\b(DRIVE|DR)\b\.?$/i, 'DR')
      .replace(/\b(ROAD|RD)\b\.?$/i, 'RD')
      .replace(/\b(BOULEVARD|BLVD)\b\.?$/i, 'BLVD')
      .replace(/\b(LANE|LN)\b\.?$/i, 'LN')
      .replace(/\b(PIKE|PK)\b\.?$/i, 'PIKE')
      .replace(/\b(COURT|CT)\b\.?$/i, 'CT')
      .replace(/\b(CIRCLE|CIR)\b\.?$/i, 'CIR')
      .replace(/,?\s*(NASHVILLE|CLARKSVILLE|FRANKLIN|MURFREESBORO|GALLATIN|SMYRNA|COLUMBIA|LEBANON|MT\.?\s*JULIET|HENDERSONVILLE|BRENTWOOD|SPRING\s*HILL|LA\s*VERGNE).*$/i, '')
      .replace(/,?\s*TN\s*\d*$/i, '')
      .replace(/,?\s*(DALLAS|FORT\s*WORTH|ARLINGTON|IRVING|PLANO|GARLAND|MESQUITE|CARROLLTON|RICHARDSON|GRAND\s*PRAIRIE|DENTON|MCKINNEY|FRISCO|ALLEN|LEWISVILLE|FLOWER\s*MOUND|EULESS|BEDFORD|HURST).*$/i, '')
      .replace(/,?\s*TX\s*\d*$/i, '')
      .trim();
    return { number: match[1], street: street };
  }
  return { number: null, street: clean };
}

function sanitize(str) {
  return str.replace(/'/g, "''").replace(/[;\-]/g, '').trim();
}

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return await resp.json();
}

async function cachedFetch(url, cacheCategory, ctx) {
  // For now, direct fetch with CORS headers
  // Cloudflare Cache API can be added for production
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ error: err.message, url: url }, 502);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    }
  });
}
