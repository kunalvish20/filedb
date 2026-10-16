import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
    const headers = { "Cache-Control": "no-store" };
    if (!process.env.MONGODB_URI?.trim()) {
        return NextResponse.json({ status: "unconfigured" }, { status: 503, headers });
    }
    try {
        const connection = await dbConnect();
        await connection.connection.db.command({ ping: 1 }, { maxTimeMS: 5000 });
        return NextResponse.json({ status: "ready" }, { headers });
    }
    catch {
        // Connection errors can include credentials or hostnames. Keep them private.
        return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
    }
}
