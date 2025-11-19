import { fetchParts } from "@/lib/api";
import Image from "next/image";

export default async function PartsPage(props: {
  searchParams: Promise<{ category?: string; cpu?: string }>;
}) {
  const { category, cpu } = await props.searchParams;

  const selectedCategory = category || "cpu";

  if (selectedCategory === "motherboard" && cpu) {
    return await loadCompatibleMotherboards(cpu);
  }

  const data = await fetchParts(selectedCategory);
  const parts = data.parts || [];

  return (
    <div className="p-8 text-white">
      <h1 className="text-3xl font-bold mb-6">
        Select {selectedCategory.toUpperCase()}
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {parts.map((part: any) => (
          <div
            key={part.id}
            className="bg-gray-900 p-4 rounded-lg shadow-lg border border-gray-700"
          >
            <Image
              src={part.image}
              alt={part.name}
              width={300}
              height={200}
              className="w-full h-40 object-cover rounded"
            />

            <h2 className="text-xl font-semibold mt-4">{part.name}</h2>

            <p className="text-sm text-gray-400">
              Vendor: {part.vendor} — ${part.price}
            </p>

            <p className="text-sm text-gray-500 mt-2">
              Specs: {JSON.stringify(part.specs)}
            </p>

            <a
              href={`/parts?category=motherboard&cpu=${part.id}`}
              className="block mt-4 bg-blue-600 hover:bg-blue-700 text-white text-center py-2 rounded"
            >
              Select
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

async function loadCompatibleMotherboards(cpuId: string) {
  const cpuData = await fetchParts("cpu");
  const motherboardsData = await fetchParts("motherboard");

  const cpuPart = cpuData.parts.find((p: any) => p.id === cpuId);
  const motherboards = motherboardsData.parts;

  const compatibleBoards: any[] = [];

  for (const mb of motherboards) {
    const result = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL}/compatibility`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [cpuPart, mb],
        }),
      }
    );

    const json = await result.json();

    if (json.compatible) {
      compatibleBoards.push(mb);
    }
  }

  return (
    <div className="p-8 text-white">
      <h1 className="text-3xl font-bold mb-6">Select Motherboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {compatibleBoards.map((mb) => (
          <div
            key={mb.id}
            className="bg-gray-900 p-4 rounded-lg shadow-lg border border-gray-700"
          >
            <Image
              src={mb.image}
              alt={mb.name}
              width={300}
              height={200}
              className="w-full h-40 object-cover rounded"
            />

            <h2 className="text-xl font-semibold mt-4">{mb.name}</h2>
            <p className="text-sm text-gray-400">
              Vendor: {mb.vendor} — ${mb.price}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Specs: {JSON.stringify(mb.specs)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
