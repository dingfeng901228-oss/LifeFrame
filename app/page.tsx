import { Globe } from '@/components/Globe';

export default function Home() {
  return (
    <div className="relative h-[calc(100vh-65px)] w-full overflow-hidden">
      <div className="absolute inset-0">
        <Globe />
      </div>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-xs tracking-[0.4em] text-white/50 uppercase">
          写真で、暮らしの軌跡を残す
        </p>
        <h1 className="mt-4 text-3xl font-light text-white md:text-4xl">
          用照片，留下生活的痕迹。
        </h1>
        <p className="mt-3 max-w-sm text-sm text-white/50">
          P0 骨架 · 首页空 3D 地球仪已就位，等待照片点亮地点
        </p>
      </div>
    </div>
  );
}
