/** Never put an API error object into state that is rendered as a list. */
export async function readApiArray(response) {
    const data = await response.json();
    if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Could not load data");
    }
    if (!Array.isArray(data)) {
        throw new Error("The server returned an invalid list response");
    }
    return data;
}
