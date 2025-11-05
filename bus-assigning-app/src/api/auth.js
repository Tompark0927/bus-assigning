// src/api/auth.js
import { Platform } from "react-native";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * API URL 결정:
 * - iOS 시뮬레이터: localhost 사용 가능
 * - Android 에뮬레이터: 10.0.2.2 로컬호스트 프록시
 * - 실제 기기: 같은 Wi-Fi의 PC IP 또는 EXPO_PUBLIC_API_URL 사용
 */
const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();

// 개발 중 다양한 환경 대응
let defaultURL;
if (fromEnv) {
  defaultURL = fromEnv;
} else if (Platform.OS === "ios") {
  defaultURL = "http://localhost:3000";
} else {
  // Android - 여러 옵션 시도
  // 1. 에뮬레이터 기본: 10.0.2.2
  // 2. 실제 기기나 다른 환경: 본인 PC의 실제 IP 주소 사용
  defaultURL = "http://10.0.2.2:3000";
  
  // 만약 10.0.2.2가 안 되면 아래 주석을 해제하고 실제 IP 입력
  // defaultURL = "http://192.168.1.XXX:3000"; // 본인 PC의 실제 IP
}

const API_URL = defaultURL;

console.log('[API_URL]', API_URL); // 디버깅용

// 공통 axios 인스턴스 (타임아웃 & 에러메시지 표준화)
const api = axios.create({ 
  baseURL: API_URL, 
  timeout: 15000, // 타임아웃 늘림
  headers: {
    'Content-Type': 'application/json',
  }
});

// 요청 인터셉터 - 디버깅용
api.interceptors.request.use(
  (config) => {
    console.log('[API Request]', config.method?.toUpperCase(), config.url, config.data);
    return config;
  },
  (error) => {
    console.log('[API Request Error]', error);
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (res) => {
    console.log('[API Response]', res.config.url, res.status);
    return res;
  },
  (err) => {
    console.log('[API Response Error]', err.config?.url, err.code, err.message);
    
    const msg =
      err?.response?.data?.error ||
      err?.response?.data?.message ||
      err?.message ||
      "네트워크 오류가 발생했습니다.";
    err._friendlyMessage = msg;
    return Promise.reject(err);
  }
);

/** 인증번호 요청 */
export async function requestCode(name, phone) {
  console.log('[request-code] sending', { name, phone });
  try {
    const res = await api.post("/auth/request-code", { name, phone });
    console.log('[request-code] success', res.data);
    return res.data; // { success, message, ... }
  } catch (error) {
    console.log('[request-code] error', error);
    throw error;
  }
}

/** 인증번호 검증 + JWT 저장 */
export async function verifyCode(name, phone, code) {
  console.log('[verify-code] sending', { name, phone, code });
  try {
    const res = await api.post("/auth/verify-code", { name, phone, code });
    if (res.data?.token) {
      await AsyncStorage.setItem("token", res.data.token);
      console.log('[verify-code] token saved');
    }
    console.log('[verify-code] success', res.data);
    return res.data; // { success, token?, error? }
  } catch (error) {
    console.log('[verify-code] error', error);
    throw error;
  }
}

/** 내 프로필 조회 (JWT 필요) */
export async function getProfile() {
  const token = await AsyncStorage.getItem("token");
  if (!token) throw new Error("토큰 없음");
  console.log('[get-profile] sending with token');
  try {
    const res = await api.get("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log('[get-profile] success', res.data);
    return res;
  } catch (error) {
    console.log('[get-profile] error', error);
    throw error;
  }
}

/** 로그아웃 (로컬 토큰 제거) */
export async function logout() {
  await AsyncStorage.removeItem("token");
  await AsyncStorage.removeItem("driver");
  console.log('[logout] tokens cleared');
}

export { API_URL };