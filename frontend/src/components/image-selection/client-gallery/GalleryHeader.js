export default function GalleryHeader({ displayName }) {
  return <header className="text-center"><p className="font-serif text-5xl leading-none tracking-[-0.04em] text-slate-950 sm:text-6xl">Welcome</p><h1 className="mt-4 font-serif text-3xl leading-tight tracking-[-0.04em] text-slate-900 sm:text-[3.45rem]">{displayName || "Your Gallery"}</h1></header>;
}
