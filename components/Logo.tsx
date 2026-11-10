/* eslint-disable @next/next/no-img-element */
export function Logo({ className = "h-8" }: { className?: string }) {
  return <img src="/brand/candly-wordmark.png" alt="Candly" className={`${className} w-auto select-none`} draggable={false} />;
}

export function Flame({ className = "h-6 w-6" }: { className?: string }) {
  return <img src="/brand/flame.png" alt="" className={className} draggable={false} />;
}
