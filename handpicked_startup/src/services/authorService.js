import axios from "axios";
import { API_BASE_URL } from "../config/api";

const http = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
});

export async function listAuthors(params = {}) {
  try {
    const res = await http.get("/authors", { params });
    return { data: res.data?.data ?? [], error: res.data?.error ?? null };
  } catch (err) {
    return { data: [], error: { message: err.message } };
  }
}

export async function getAuthor(id) {
  try {
    const res = await http.get(`/authors/${id}`);
    return res.data?.data ?? null;
  } catch {
    return null;
  }
}

// export async function createAuthor(payload) {
//   try {
//     const res = await http.post("/authors", payload);
//     return { data: res.data?.data ?? null, error: res.data?.error ?? null };
//   } catch (err) {
//     return { data: null, error: { message: err.message } };
//   }
// }

// export async function updateAuthor(id, payload) {
//   try {
//     const res = await http.put(`/authors/${id}`, payload);
//     return { data: res.data?.data ?? null, error: res.data?.error ?? null };
//   } catch (err) {
//     return { data: null, error: { message: err.message } };
//   }
// }

export async function createAuthor(payload) {
  try {
    const res = await http.post("/authors", payload);
    return { data: res.data?.data ?? null, error: null };
  } catch (err) {
    const error = err.response?.data?.error || {
      message: err.message,
    };
    return { data: null, error };
  }
}

export async function updateAuthor(id, payload) {
  try {
    const res = await http.put(`/authors/${id}`, payload);
    return { data: res.data?.data ?? null, error: null };
  } catch (err) {
    const error = err.response?.data?.error || {
      message: err.message,
    };
    return { data: null, error };
  }
}

export async function deleteAuthor(id) {
  try {
    const res = await http.delete(`/authors/${id}`);
    return { data: res.data?.data ?? null, error: res.data?.error ?? null };
  } catch (err) {
    return { data: null, error: { message: err.message } };
  }
}

export async function updateAuthorStatus(id, is_active) {
  try {
    const res = await http.patch(`/authors/${id}/status`, { is_active });
    return { data: res.data?.data ?? null, error: res.data?.error ?? null };
  } catch (err) {
    return { data: null, error: { message: err.message } };
  }
}
