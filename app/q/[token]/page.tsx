import { notFound } from 'next/navigation';
import BrandShell from '@/components/BrandShell';
import StudyApp from '@/components/StudyApp';
import { copy } from '@/lib/copy';
import { env, isStudyOpen } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function StudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  if (token !== env.studyToken) notFound();
  const test = sp.test === '1';
  if (!test && !isStudyOpen()) {
    return (
      <BrandShell>
        <p className="mt-16 text-center text-[22px]">{copy['closed.text']}</p>
      </BrandShell>
    );
  }
  return <StudyApp token={token} test={test} />;
}
