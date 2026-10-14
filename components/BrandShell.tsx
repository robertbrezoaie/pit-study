import Image from 'next/image';

/**
 * Page frame following the Punctul IT brand rules: a brand-blue frame around the working area
 * with the logo in one corner, inside the frame. Identical on every screen and for every arm.
 */
export default function BrandShell({ children, badge }: { children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="min-h-dvh p-3 sm:p-6">
      <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col border-[3px] border-brand-bright bg-card sm:min-h-[calc(100dvh-3rem)]">
        <header className="flex items-start justify-between px-4 pt-4 sm:px-8 sm:pt-6">
          <Image src="/brand/punctul-it-logo-512.png" alt="Punctul IT" width={72} height={72} priority className="h-16 w-16 sm:h-[72px] sm:w-[72px]" />
          {badge}
        </header>
        <div className="flex flex-1 flex-col px-4 pt-2 pb-8 sm:px-10 sm:pb-10">{children}</div>
      </div>
    </div>
  );
}
