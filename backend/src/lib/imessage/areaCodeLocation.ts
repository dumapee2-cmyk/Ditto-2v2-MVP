/**
 * Area code → location mapping for automatic user geolocation.
 * Maps US/Canada area codes to city, state, and approximate coordinates.
 */

export interface AreaCodeLocation {
  city: string;
  state: string;
  lat: number;
  lng: number;
}

// Top ~200 US area codes covering major metro areas
const AREA_CODES: Record<string, AreaCodeLocation> = {
  // California
  "209": { city: "Stockton", state: "CA", lat: 37.9577, lng: -121.2908 },
  "213": { city: "Los Angeles", state: "CA", lat: 34.0522, lng: -118.2437 },
  "310": { city: "Los Angeles", state: "CA", lat: 33.9425, lng: -118.4081 },
  "323": { city: "Los Angeles", state: "CA", lat: 34.0522, lng: -118.2437 },
  "408": { city: "San Jose", state: "CA", lat: 37.3382, lng: -121.8863 },
  "415": { city: "San Francisco", state: "CA", lat: 37.7749, lng: -122.4194 },
  "424": { city: "Los Angeles", state: "CA", lat: 34.0522, lng: -118.2437 },
  "510": { city: "Oakland", state: "CA", lat: 37.8044, lng: -122.2712 },
  "530": { city: "Sacramento", state: "CA", lat: 38.5816, lng: -121.4944 },
  "559": { city: "Fresno", state: "CA", lat: 36.7378, lng: -119.7871 },
  "562": { city: "Long Beach", state: "CA", lat: 33.7701, lng: -118.1937 },
  "619": { city: "San Diego", state: "CA", lat: 32.7157, lng: -117.1611 },
  "626": { city: "Pasadena", state: "CA", lat: 34.1478, lng: -118.1445 },
  "650": { city: "San Mateo", state: "CA", lat: 37.5630, lng: -122.3255 },
  "657": { city: "Anaheim", state: "CA", lat: 33.8366, lng: -117.9143 },
  "661": { city: "Bakersfield", state: "CA", lat: 35.3733, lng: -119.0187 },
  "669": { city: "San Jose", state: "CA", lat: 37.3382, lng: -121.8863 },
  "707": { city: "Santa Rosa", state: "CA", lat: 38.4404, lng: -122.7141 },
  "714": { city: "Anaheim", state: "CA", lat: 33.8366, lng: -117.9143 },
  "747": { city: "Los Angeles", state: "CA", lat: 34.0522, lng: -118.2437 },
  "760": { city: "Oceanside", state: "CA", lat: 33.1959, lng: -117.3795 },
  "805": { city: "Santa Barbara", state: "CA", lat: 34.4208, lng: -119.6982 },
  "818": { city: "Burbank", state: "CA", lat: 34.1808, lng: -118.3090 },
  "831": { city: "Salinas", state: "CA", lat: 36.6777, lng: -121.6555 },
  "858": { city: "San Diego", state: "CA", lat: 32.8328, lng: -117.2713 },
  "909": { city: "San Bernardino", state: "CA", lat: 34.1083, lng: -117.2898 },
  "916": { city: "Sacramento", state: "CA", lat: 38.5816, lng: -121.4944 },
  "925": { city: "Concord", state: "CA", lat: 37.9780, lng: -122.0311 },
  "949": { city: "Irvine", state: "CA", lat: 33.6846, lng: -117.8265 },
  "951": { city: "Riverside", state: "CA", lat: 33.9533, lng: -117.3962 },
  // New York
  "212": { city: "New York", state: "NY", lat: 40.7128, lng: -74.0060 },
  "315": { city: "Syracuse", state: "NY", lat: 43.0481, lng: -76.1474 },
  "347": { city: "New York", state: "NY", lat: 40.7128, lng: -74.0060 },
  "516": { city: "Hempstead", state: "NY", lat: 40.7062, lng: -73.6187 },
  "518": { city: "Albany", state: "NY", lat: 42.6526, lng: -73.7562 },
  "585": { city: "Rochester", state: "NY", lat: 43.1566, lng: -77.6088 },
  "607": { city: "Binghamton", state: "NY", lat: 42.0987, lng: -75.9180 },
  "631": { city: "Suffolk County", state: "NY", lat: 40.7891, lng: -73.1350 },
  "646": { city: "New York", state: "NY", lat: 40.7128, lng: -74.0060 },
  "716": { city: "Buffalo", state: "NY", lat: 42.8864, lng: -78.8784 },
  "718": { city: "New York", state: "NY", lat: 40.6892, lng: -73.9857 },
  "845": { city: "Poughkeepsie", state: "NY", lat: 41.7004, lng: -73.9210 },
  "914": { city: "Westchester", state: "NY", lat: 41.1220, lng: -73.7949 },
  "917": { city: "New York", state: "NY", lat: 40.7128, lng: -74.0060 },
  "929": { city: "New York", state: "NY", lat: 40.7128, lng: -74.0060 },
  // Texas
  "210": { city: "San Antonio", state: "TX", lat: 29.4241, lng: -98.4936 },
  "214": { city: "Dallas", state: "TX", lat: 32.7767, lng: -96.7970 },
  "254": { city: "Waco", state: "TX", lat: 31.5493, lng: -97.1467 },
  "281": { city: "Houston", state: "TX", lat: 29.7604, lng: -95.3698 },
  "325": { city: "Abilene", state: "TX", lat: 32.4487, lng: -99.7331 },
  "346": { city: "Houston", state: "TX", lat: 29.7604, lng: -95.3698 },
  "361": { city: "Corpus Christi", state: "TX", lat: 27.8006, lng: -97.3964 },
  "409": { city: "Beaumont", state: "TX", lat: 30.0802, lng: -94.1266 },
  "430": { city: "Tyler", state: "TX", lat: 32.3513, lng: -95.3011 },
  "432": { city: "Midland", state: "TX", lat: 31.9973, lng: -102.0779 },
  "469": { city: "Dallas", state: "TX", lat: 32.7767, lng: -96.7970 },
  "512": { city: "Austin", state: "TX", lat: 30.2672, lng: -97.7431 },
  "682": { city: "Fort Worth", state: "TX", lat: 32.7555, lng: -97.3308 },
  "713": { city: "Houston", state: "TX", lat: 29.7604, lng: -95.3698 },
  "726": { city: "San Antonio", state: "TX", lat: 29.4241, lng: -98.4936 },
  "737": { city: "Austin", state: "TX", lat: 30.2672, lng: -97.7431 },
  "806": { city: "Lubbock", state: "TX", lat: 33.5779, lng: -101.8552 },
  "817": { city: "Fort Worth", state: "TX", lat: 32.7555, lng: -97.3308 },
  "832": { city: "Houston", state: "TX", lat: 29.7604, lng: -95.3698 },
  "903": { city: "Tyler", state: "TX", lat: 32.3513, lng: -95.3011 },
  "915": { city: "El Paso", state: "TX", lat: 31.7619, lng: -106.4850 },
  "936": { city: "Huntsville", state: "TX", lat: 30.7235, lng: -95.5508 },
  "940": { city: "Denton", state: "TX", lat: 33.2148, lng: -97.1331 },
  "956": { city: "Laredo", state: "TX", lat: 27.5036, lng: -99.5076 },
  "972": { city: "Dallas", state: "TX", lat: 32.7767, lng: -96.7970 },
  // Florida
  "239": { city: "Fort Myers", state: "FL", lat: 26.6406, lng: -81.8723 },
  "305": { city: "Miami", state: "FL", lat: 25.7617, lng: -80.1918 },
  "321": { city: "Orlando", state: "FL", lat: 28.5383, lng: -81.3792 },
  "352": { city: "Gainesville", state: "FL", lat: 29.6516, lng: -82.3248 },
  "386": { city: "Daytona Beach", state: "FL", lat: 29.2108, lng: -81.0228 },
  "407": { city: "Orlando", state: "FL", lat: 28.5383, lng: -81.3792 },
  "561": { city: "West Palm Beach", state: "FL", lat: 26.7153, lng: -80.0534 },
  "727": { city: "St. Petersburg", state: "FL", lat: 27.7676, lng: -82.6403 },
  "754": { city: "Fort Lauderdale", state: "FL", lat: 26.1224, lng: -80.1373 },
  "772": { city: "Port St. Lucie", state: "FL", lat: 27.2730, lng: -80.3582 },
  "786": { city: "Miami", state: "FL", lat: 25.7617, lng: -80.1918 },
  "813": { city: "Tampa", state: "FL", lat: 27.9506, lng: -82.4572 },
  "850": { city: "Tallahassee", state: "FL", lat: 30.4383, lng: -84.2807 },
  "863": { city: "Lakeland", state: "FL", lat: 28.0395, lng: -81.9498 },
  "904": { city: "Jacksonville", state: "FL", lat: 30.3322, lng: -81.6557 },
  "941": { city: "Sarasota", state: "FL", lat: 27.3364, lng: -82.5307 },
  "954": { city: "Fort Lauderdale", state: "FL", lat: 26.1224, lng: -80.1373 },
  // Illinois
  "217": { city: "Springfield", state: "IL", lat: 39.7817, lng: -89.6501 },
  "224": { city: "Arlington Heights", state: "IL", lat: 42.0884, lng: -87.9806 },
  "309": { city: "Peoria", state: "IL", lat: 40.6936, lng: -89.5890 },
  "312": { city: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 },
  "331": { city: "Aurora", state: "IL", lat: 41.7606, lng: -88.3201 },
  "618": { city: "Belleville", state: "IL", lat: 38.5201, lng: -89.9840 },
  "630": { city: "Naperville", state: "IL", lat: 41.7508, lng: -88.1535 },
  "708": { city: "Cicero", state: "IL", lat: 41.8456, lng: -87.7539 },
  "773": { city: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 },
  "815": { city: "Rockford", state: "IL", lat: 42.2711, lng: -89.0940 },
  "847": { city: "Evanston", state: "IL", lat: 42.0451, lng: -87.6877 },
  "872": { city: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 },
  // Other major metros
  "201": { city: "Jersey City", state: "NJ", lat: 40.7178, lng: -74.0431 },
  "202": { city: "Washington", state: "DC", lat: 38.9072, lng: -77.0369 },
  "203": { city: "Bridgeport", state: "CT", lat: 41.1865, lng: -73.1952 },
  "206": { city: "Seattle", state: "WA", lat: 47.6062, lng: -122.3321 },
  "215": { city: "Philadelphia", state: "PA", lat: 39.9526, lng: -75.1652 },
  "216": { city: "Cleveland", state: "OH", lat: 41.4993, lng: -81.6944 },
  "225": { city: "Baton Rouge", state: "LA", lat: 30.4515, lng: -91.1871 },
  "240": { city: "Bethesda", state: "MD", lat: 38.9807, lng: -77.1003 },
  "248": { city: "Troy", state: "MI", lat: 42.6064, lng: -83.1498 },
  "253": { city: "Tacoma", state: "WA", lat: 47.2529, lng: -122.4443 },
  "267": { city: "Philadelphia", state: "PA", lat: 39.9526, lng: -75.1652 },
  "301": { city: "Silver Spring", state: "MD", lat: 38.9907, lng: -77.0261 },
  "303": { city: "Denver", state: "CO", lat: 39.7392, lng: -104.9903 },
  "304": { city: "Charleston", state: "WV", lat: 38.3498, lng: -81.6326 },
  "313": { city: "Detroit", state: "MI", lat: 42.3314, lng: -83.0458 },
  "314": { city: "St. Louis", state: "MO", lat: 38.6270, lng: -90.1994 },
  "316": { city: "Wichita", state: "KS", lat: 37.6872, lng: -97.3301 },
  "317": { city: "Indianapolis", state: "IN", lat: 39.7684, lng: -86.1581 },
  "318": { city: "Shreveport", state: "LA", lat: 32.5252, lng: -93.7502 },
  "330": { city: "Akron", state: "OH", lat: 41.0814, lng: -81.5190 },
  "334": { city: "Montgomery", state: "AL", lat: 32.3668, lng: -86.3000 },
  "336": { city: "Greensboro", state: "NC", lat: 36.0726, lng: -79.7920 },
  "339": { city: "Boston", state: "MA", lat: 42.3601, lng: -71.0589 },
  "401": { city: "Providence", state: "RI", lat: 41.8240, lng: -71.4128 },
  "402": { city: "Omaha", state: "NE", lat: 41.2565, lng: -95.9345 },
  "404": { city: "Atlanta", state: "GA", lat: 33.7490, lng: -84.3880 },
  "405": { city: "Oklahoma City", state: "OK", lat: 35.4676, lng: -97.5164 },
  "410": { city: "Baltimore", state: "MD", lat: 39.2904, lng: -76.6122 },
  "412": { city: "Pittsburgh", state: "PA", lat: 40.4406, lng: -79.9959 },
  "414": { city: "Milwaukee", state: "WI", lat: 43.0389, lng: -87.9065 },
  "425": { city: "Bellevue", state: "WA", lat: 47.6101, lng: -122.2015 },
  "443": { city: "Baltimore", state: "MD", lat: 39.2904, lng: -76.6122 },
  "484": { city: "Allentown", state: "PA", lat: 40.6084, lng: -75.4902 },
  "501": { city: "Little Rock", state: "AR", lat: 34.7465, lng: -92.2896 },
  "502": { city: "Louisville", state: "KY", lat: 38.2527, lng: -85.7585 },
  "503": { city: "Portland", state: "OR", lat: 45.5152, lng: -122.6784 },
  "504": { city: "New Orleans", state: "LA", lat: 29.9511, lng: -90.0715 },
  "505": { city: "Albuquerque", state: "NM", lat: 35.0844, lng: -106.6504 },
  "507": { city: "Rochester", state: "MN", lat: 44.0121, lng: -92.4802 },
  "508": { city: "Worcester", state: "MA", lat: 42.2626, lng: -71.8023 },
  "513": { city: "Cincinnati", state: "OH", lat: 39.1031, lng: -84.5120 },
  "515": { city: "Des Moines", state: "IA", lat: 41.5868, lng: -93.6250 },
  "517": { city: "Lansing", state: "MI", lat: 42.7325, lng: -84.5555 },
  "520": { city: "Tucson", state: "AZ", lat: 32.2226, lng: -110.9747 },
  "571": { city: "Arlington", state: "VA", lat: 38.8816, lng: -77.0910 },
  "602": { city: "Phoenix", state: "AZ", lat: 33.4484, lng: -112.0740 },
  "603": { city: "Manchester", state: "NH", lat: 42.9956, lng: -71.4548 },
  "612": { city: "Minneapolis", state: "MN", lat: 44.9778, lng: -93.2650 },
  "614": { city: "Columbus", state: "OH", lat: 39.9612, lng: -82.9988 },
  "615": { city: "Nashville", state: "TN", lat: 36.1627, lng: -86.7816 },
  "616": { city: "Grand Rapids", state: "MI", lat: 42.9634, lng: -85.6681 },
  "617": { city: "Boston", state: "MA", lat: 42.3601, lng: -71.0589 },
  "678": { city: "Atlanta", state: "GA", lat: 33.7490, lng: -84.3880 },
  "702": { city: "Las Vegas", state: "NV", lat: 36.1699, lng: -115.1398 },
  "703": { city: "Arlington", state: "VA", lat: 38.8816, lng: -77.0910 },
  "704": { city: "Charlotte", state: "NC", lat: 35.2271, lng: -80.8431 },
  "720": { city: "Denver", state: "CO", lat: 39.7392, lng: -104.9903 },
  "724": { city: "New Castle", state: "PA", lat: 41.0034, lng: -80.3470 },
  "734": { city: "Ann Arbor", state: "MI", lat: 42.2808, lng: -83.7430 },
  "757": { city: "Virginia Beach", state: "VA", lat: 36.8529, lng: -75.9780 },
  "770": { city: "Atlanta", state: "GA", lat: 33.7490, lng: -84.3880 },
  "775": { city: "Reno", state: "NV", lat: 39.5296, lng: -119.8138 },
  "781": { city: "Boston", state: "MA", lat: 42.3601, lng: -71.0589 },
  "801": { city: "Salt Lake City", state: "UT", lat: 40.7608, lng: -111.8910 },
  "802": { city: "Burlington", state: "VT", lat: 44.4759, lng: -73.2121 },
  "803": { city: "Columbia", state: "SC", lat: 34.0007, lng: -81.0348 },
  "804": { city: "Richmond", state: "VA", lat: 37.5407, lng: -77.4360 },
  "808": { city: "Honolulu", state: "HI", lat: 21.3069, lng: -157.8583 },
  "810": { city: "Flint", state: "MI", lat: 43.0125, lng: -83.6875 },
  "843": { city: "Charleston", state: "SC", lat: 32.7765, lng: -79.9311 },
  "848": { city: "New Brunswick", state: "NJ", lat: 40.4862, lng: -74.4518 },
  "856": { city: "Camden", state: "NJ", lat: 39.9259, lng: -75.1196 },
  "857": { city: "Boston", state: "MA", lat: 42.3601, lng: -71.0589 },
  "860": { city: "Hartford", state: "CT", lat: 41.7658, lng: -72.6734 },
  "901": { city: "Memphis", state: "TN", lat: 35.1495, lng: -90.0490 },
  "910": { city: "Fayetteville", state: "NC", lat: 35.0527, lng: -78.8784 },
  "913": { city: "Kansas City", state: "KS", lat: 39.1141, lng: -94.6275 },
  "919": { city: "Raleigh", state: "NC", lat: 35.7796, lng: -78.6382 },
  "920": { city: "Green Bay", state: "WI", lat: 44.5133, lng: -88.0133 },
  "971": { city: "Portland", state: "OR", lat: 45.5152, lng: -122.6784 },
  "973": { city: "Newark", state: "NJ", lat: 40.7357, lng: -74.1724 },
};

/**
 * Look up approximate location from a phone number's area code.
 * Returns null if the area code isn't in our database.
 */
export function lookupLocationByPhone(phone: string): AreaCodeLocation | null {
  // Strip to digits only
  const digits = phone.replace(/\D/g, "");

  // US numbers: could be 10 digits or 11 (with leading 1)
  let areaCode: string;
  if (digits.length === 11 && digits.startsWith("1")) {
    areaCode = digits.slice(1, 4);
  } else if (digits.length === 10) {
    areaCode = digits.slice(0, 3);
  } else {
    return null;
  }

  return AREA_CODES[areaCode] ?? null;
}

/**
 * Get a location string like "Irvine, CA" from a phone number.
 */
export function getLocationString(phone: string): string | null {
  const loc = lookupLocationByPhone(phone);
  return loc ? `${loc.city}, ${loc.state}` : null;
}
