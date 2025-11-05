import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getProfile } from "../api/auth";

export default function AuthLoadingScreen({ navigation }) {
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = await AsyncStorage.getItem("token");
        if (!token) {
          navigation.replace("Login");
          return;
        }

        // 서버에 토큰 확인
        const res = await getProfile();
        if (res.data.user) {
          navigation.replace("Home");
        } else {
          navigation.replace("Login");
        }
      } catch (err) {
        navigation.replace("Login");
      }
    };

    checkAuth();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" color="#0000ff" />
    </View>
  );
}
