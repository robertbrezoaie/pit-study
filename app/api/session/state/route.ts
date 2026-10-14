import { NextResponse } from 'next/server';
import { currentState, route } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const GET = route(async () => NextResponse.json(await currentState()));
