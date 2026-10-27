/** Signed 16-bit little-endian PCM to the float range the recognizer expects. */
export function int16ToFloat32(chunk: Buffer): Float32Array {
	const count = Math.floor(chunk.length / 2);
	const out = new Float32Array(count);
	for (let i = 0; i < count; i++) out[i] = chunk.readInt16LE(i * 2) / 32768;
	return out;
}
