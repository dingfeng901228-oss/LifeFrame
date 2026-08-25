import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { FeatureCollection, Geometry } from 'geojson';
import countries110m from 'world-atlas/countries-110m.json';

// World-atlas ships countries at 110m / 50m / 10m resolutions. 110m is
// ~95 KB and renders smoothly on a 900 px globe; it has ~177 country
// polygons with built-in admin boundaries.

// The package's TS types claim this is `Default` but at runtime the file
// is a TopoJSON. We cast through unknown to bridge the package types to
// the real shape.

const topo = countries110m as unknown as Topology;

const countriesGeo = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry>;

export default countriesGeo;
