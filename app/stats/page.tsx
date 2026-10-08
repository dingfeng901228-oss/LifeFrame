import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { WorldDotMap } from '@/components/WorldDotMap';
import { CollapseCountryButton } from '@/components/CollapseCountryButton';

export const metadata: Metadata = {
  title: 'LifeFrame — 足迹统计',
  description:
    '按国家 / 城市分组的照片分布统计 — LifeFrame 走过的地方。',
  robots: { index: true, follow: true },
};

type PhotoRow = {
  location_name: string | null;
};

type LocationParts = { city: string; country: string };

/**
 * Parse a Nominatim-style "City, Region, Country" string into
 * { city, country }. Last comma-separated segment is country, first is
 * city. Middle segments are folded into city ("Kanagawa, Japan"
 → // "Kanagawa"). Empty / null returns null (skipped in stats).
 *
 * Frank #0906 round-14: skip Chinese / Japanese admin levels
 * (province/prefecture/district/ward/city-with-suffix) so the
 * last segment is actually the country. Without the filter Frank's
 * location strings (e.g. "威海市, 山东省, 中国" parsed as
 * country=山东省 because of "山东省" being the second-to-last
 * segment when the actual country is "中国") fragment the stats
 * page into 27 mostly-unrecognised "countries".
 */
const ADMIN_LEVELS_CN = new Set([
  '北京市', '上海市', '天津市', '重庆市',
  '河北省', '山西省', '辽宁省', '吉林省', '黑龙江省',
  '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省',
  '河南省', '湖北省', '湖南省', '广东省', '海南省',
  '四川省', '贵州省', '云南省', '陕西省', '甘肃省', '青海省',
  '台湾省',
  '内蒙古自治区', '广西壮族自治区', '西藏自治区', '宁夏回族自治区', '新疆维吾尔自治区',
  '香港特别行政区', '澳门特别行政区',
]);
// Japanese prefectures end in 都/道/府/県.
const JP_PREF = new Set([
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
]);
// Korean provinces + 도.
const KR_PREF = new Set([
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시',
  '대전광역시', '울산광역시', '세종특별자치시',
  '경기도', '강원특별자치도', '충청북도', '충청남도',
  '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도',
]);

function isAdminLevelCN(s: string): boolean {
  if (ADMIN_LEVELS_CN.has(s)) return true;
  if (JP_PREF.has(s)) return true;
  if (KR_PREF.has(s)) return true;
  // Generic CN: district 县/区/市 + ward 街道/镇/乡/村
  if (/(?:区|县|镇|乡|村|街道)$/.test(s)) return true;
  return false;
}

function parseLocation(loc: string | null): LocationParts | null {
  if (!loc) return null;
  const parts = loc
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  let country = parts[parts.length - 1];
  // Drop trailing admin levels until we hit something that looks
  // like a real country name. If everything drops out, null.
  while (isAdminLevelCN(country) && parts.length > 1) {
    parts.pop();
    country = parts[parts.length - 1];
  }
  return { city: parts[0], country };
}

export default async function StatsPage() {
  let photos: PhotoRow[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from('photos')
      .select('location_name')
      .in('visibility', ['public', 'unlisted']);
    photos = (data ?? []) as PhotoRow[];
  } catch {
    // Env not configured (build-time prerender).
  }

  // Group photos by country, then by city.
  const countryMap = new Map<string, Map<string, number>>();
  for (const p of photos) {
    const loc = parseLocation(p.location_name);
    if (!loc) continue;
    const cityMap = countryMap.get(loc.country) ?? new Map<string, number>();
    cityMap.set(loc.city, (cityMap.get(loc.city) ?? 0) + 1);
    countryMap.set(loc.country, cityMap);
  }

  // Convert to sorted array: countries by total photo count desc;
  // within each country, cities by count desc.
  const countries = [...countryMap.entries()]
    .map(([country, cities]) => ({
      country,
      total: [...cities.values()].reduce((s, n) => s + n, 0),
      cities: [...cities.entries()]
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.total - a.total);

  const totalPhotos = photos.length;
  const totalCountries = countries.length;
  const totalCities = countries.reduce((s, c) => s + c.cities.length, 0);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10">
        <p className="text-xs tracking-[0.4em] text-black/40 dark:text-white/40 uppercase">
          Stats · §27
        </p>
        <h1 className="mt-2 text-3xl font-light text-black dark:text-white">
          🌍 足迹统计
        </h1>
        <p className="mt-2 text-sm text-black/40 dark:text-white/40">
          按国家和城市分组的照片分布
        </p>
      </header>

      {/* Frank #0906 round-14 (Batch C): top row keeps the three
          big-number tiles but adds a 1-row mini equirectangular
          world map below, where each cyan dot is one country
          (positioned by centroid, sized by photo count). Below
          the map the country list is now collapsed by default
          (Frank #7108 collapse pattern) so the page is one
          screenful on desktop. The map dots and the country
          cards are linked: clicking a dot expands the matching
          card via the CollapseCountryButton toggle. */}
      <div className="mb-8 grid grid-cols-3 gap-4 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-6">
        <StatBox label="照片" value={totalPhotos} />
        <StatBox label="国家" value={totalCountries} />
        <StatBox label="城市" value={totalCities} />
      </div>

      {countries.length === 0 ? (
        <p className="text-black/40 dark:text-white/40">
          还没有带位置的照片
        </p>
      ) : (
        <>
          <WorldDotMap countries={countries} />
          <div className="mt-8 space-y-3">
            {countries.map((c) => (
              <CountryCard key={c.country} country={c} />
            ))}
          </div>
        </>
      )}

      <p className="mt-12 text-center text-sm text-black/40 dark:text-white/40">
        数据基于公开 + 不公开链接分享的照片（人物照片需登录可见）
      </p>
    </main>
  );
}

function CountryCard({
  country,
}: {
  country: { country: string; total: number; cities: Array<{ city: string; count: number }> };
}) {
  return (
    <section
      id={`country-${country.country}`}
      className="rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]"
    >
      <CollapseCountryButton
        title={country.country}
        total={country.total}
        cityCount={country.cities.length}
      >
        <ul className="space-y-1.5">
          {country.cities.map((city) => (
            <li
              key={city.city}
              className="flex items-baseline justify-between text-sm"
            >
              <span className="text-black/80 dark:text-white/80">
                📍 {city.city}
              </span>
              <span className="tabular-nums text-black/40 dark:text-white/40">
                {city.count}
              </span>
            </li>
          ))}
        </ul>
      </CollapseCountryButton>
    </section>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-light tabular-nums text-black dark:text-white">
        {value}
      </div>
      <div className="mt-1 text-xs uppercase tracking-widest text-black/40 dark:text-white/40">
        {label}
      </div>
    </div>
  );
}
