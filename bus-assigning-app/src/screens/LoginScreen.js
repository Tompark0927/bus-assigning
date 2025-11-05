import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage"; // ✅ 추가
import { requestCode, verifyCode } from "../api/auth";

const COOLDOWN_SEC = 180;

export default function LoginScreen({ navigation }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef(null);

  // 디버깅 로그
  useEffect(() => {
    console.log("[LoginScreen] step=", step, "loading=", loading, "cooldown=", cooldown);
  }, [step, loading, cooldown]);

  useEffect(() => {
    if (cooldown > 0) {
      cooldownRef.current = setTimeout(() => setCooldown((s) => s - 1), 1000);
    }
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    };
  }, [cooldown]);

  const resetMessages = () => {
    setError("");
    setInfo("");
  };

  const onlyDigits = (s) => s.replace(/\D/g, "");
  const isValidName = (s) => s.trim().length >= 2;
  const isValidPhone = (s) => onlyDigits(s).length >= 8;
  const isValidCode = (s) => /^\d{6}$/.test(s);

  const handleRequestCode = async () => {
    resetMessages();

    if (!isValidName(name)) {
      setError("이름을 2자 이상 입력하세요.");
      return;
    }
    if (!isValidPhone(phone)) {
      setError("전화번호는 숫자 8자리 이상이어야 합니다.");
      return;
    }
    if (cooldown > 0 || loading) return;

    try {
      setLoading(true);
      const cleanedPhone = `+${onlyDigits(phone)}`;
      console.log("[request-code] sending", { name: name.trim(), phone: cleanedPhone });

      const data = await requestCode(name.trim(), cleanedPhone);
      console.log("[request-code] response", data);

      // 서버가 정상 응답이면 2단계로 전환
      setStep(2);
      setInfo("인증번호를 문자로 보냈습니다. 3분 이내에 입력하세요.");
      setCooldown(COOLDOWN_SEC);

      Alert.alert("전송됨", "인증번호를 보냈습니다. 3분 이내에 입력하세요.");
    } catch (e) {
      console.log("[request-code] error", e);
      setError(e._friendlyMessage || "인증번호 요청 중 문제가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    resetMessages();

    if (!isValidName(name)) {
      setError("이름을 2자 이상 입력하세요.");
      return;
    }
    if (!isValidPhone(phone)) {
      setError("전화번호는 숫자 8자리 이상이어야 합니다.");
      return;
    }
    if (!isValidCode(code)) {
      setError("인증번호 6자리를 정확히 입력하세요.");
      return;
    }
    if (loading) return;

    try {
      setLoading(true);
      const cleanedPhone = `+${onlyDigits(phone)}`;
      const payload = { name: name.trim(), phone: cleanedPhone, code: code.trim() };
      console.log("[verify-code] sending", payload);

      const data = await verifyCode(payload.name, payload.phone, payload.code);
      console.log("[verify-code] response", data);

      if (data?.success) {
        // 응답에서 token과 driver(role 포함)를 구조분해
        const { token, driver } = data;
        
        // AsyncStorage에 driver 정보도 저장
        await AsyncStorage.setItem("driver", JSON.stringify(driver));

        // 사용자 피드백
        Alert.alert(
          "완료",
          driver?.role === "admin" ? "관리자 로그인 되었습니다." : "로그인 되었습니다.",
          [
            {
              text: "확인",
              onPress: () => {
                // role에 따라 화면 분기
                if (driver && driver.role === "admin") {
                  navigation.replace("Admin");
                } else {
                  navigation.replace("Home");
                }
              },
            },
          ]
        );
      } else {
        setError(data?.error || "로그인에 실패했습니다.");
      }
    } catch (e) {
      console.log("[verify-code] error", e);
      setError(e._friendlyMessage || "로그인 처리 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || loading) return;
    await handleRequestCode();
  };

  const primaryDisabled =
    loading ||
    (step === 1
      ? !isValidName(name) || !isValidPhone(phone) || cooldown > 0
      : !isValidCode(code));

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0B132B" }}
      behavior={Platform.select({ ios: "padding", android: undefined })}
    >
      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        {/* 헤더 */}
        <Text style={{ color: "#FFFFFF", fontSize: 28, fontWeight: "800", marginBottom: 8 }}>
          버스 배차 로그인
        </Text>
        <Text style={{ color: "#B0C4DE", fontSize: 14, marginBottom: 24 }}>
          전화번호로 인증하고 안전하게 로그인하세요.
        </Text>

        {/* 폼 카드 */}
        <View
          style={{
            backgroundColor: "#1C2541",
            borderRadius: 16,
            padding: 20,
            gap: 14,
            shadowColor: "#000",
            shadowOpacity: 0.2,
            shadowRadius: 12,
            elevation: 4,
          }}
        >
          {step === 1 ? (
            <>
              {/* 이름 */}
              <Text style={{ color: "#E0E6F8", fontSize: 14, marginBottom: 6 }}>이름</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="홍길동"
                placeholderTextColor="#6B7A99"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                returnKeyType="next"
              />

              {/* 전화번호 */}
              <Text style={{ color: "#E0E6F8", fontSize: 14, marginBottom: 6, marginTop: 8 }}>
                전화번호 (예: +821012345678 또는 01012345678)
              </Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+821012345678"
                placeholderTextColor="#6B7A99"
                keyboardType="phone-pad"
                style={styles.input}
                returnKeyType="done"
              />

              {/* 에러/정보 */}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {info ? <Text style={styles.infoText}>{info}</Text> : null}

              {/* 버튼 */}
              <TouchableOpacity
                onPress={handleRequestCode}
                disabled={primaryDisabled}
                style={[styles.primaryBtn, primaryDisabled ? styles.btnDisabled : null]}
              >
                {loading ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {cooldown > 0 ? `재요청 ${cooldown}s` : "인증번호 요청"}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* 코드 입력 */}
              <Text style={{ color: "#E0E6F8", fontSize: 14, marginBottom: 6 }}>
                문자로 받은 인증번호 6자리
              </Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                placeholderTextColor="#6B7A99"
                keyboardType="number-pad"
                style={styles.input}
                maxLength={6}
                autoFocus
              />

              {/* 에러/정보 */}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {info ? <Text style={styles.infoText}>{info}</Text> : null}

              {/* 버튼 */}
              <TouchableOpacity
                onPress={handleVerify}
                disabled={primaryDisabled}
                style={[styles.primaryBtn, primaryDisabled ? styles.btnDisabled : null]}
              >
                {loading ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={styles.primaryBtnText}>로그인</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleResend}
                disabled={loading || cooldown > 0}
                style={[styles.secondaryBtn, loading || cooldown > 0 ? styles.btnDisabled : null]}
              >
                <Text style={styles.secondaryBtnText}>
                  {cooldown > 0 ? `인증번호 재요청 (${cooldown}s)` : "인증번호 재요청"}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={{ color: "#9DB4C0", fontSize: 12, marginTop: 16, lineHeight: 18 }}>
          문제가 계속되면 관리자에게 문의하세요. 동일 번호로 3분 내 재요청은 제한됩니다.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = {
  input: {
    backgroundColor: "#243B53",
    color: "#E6ECF1",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#2B4C7E",
  },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: "#5BC0BE",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#0B132B",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    marginTop: 10,
    backgroundColor: "#1F4068",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2B4C7E",
  },
  secondaryBtnText: {
    color: "#CDE8F6",
    fontSize: 15,
    fontWeight: "600",
  },
  btnDisabled: { opacity: 0.5 },
  errorText: { color: "#FF6B6B", fontSize: 13, marginTop: 6 },
  infoText: { color: "#A7F3D0", fontSize: 13, marginTop: 6 },
};