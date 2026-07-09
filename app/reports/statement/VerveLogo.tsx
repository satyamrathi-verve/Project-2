/*
  Text wordmark matching the Verve Advisory logo — recreated in CSS rather
  than a bitmap, since no logo image file exists in this repo (see the
  screen-view header for how to swap in a real /public/logo.png later if
  the team adds one: replace this component's contents with an <img>).
*/
export function VerveLogo({ className }: { className?: string }) {
  return (
    <div className={className}>
      <p className="text-2xl font-extrabold italic leading-none tracking-tight text-brand">verve</p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">Advisory</p>
    </div>
  );
}
