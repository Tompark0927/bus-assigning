// App.js
// import "react-native-gesture-handler"; // 이 라인 주석 처리 또는 삭제

import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { API_URL } from "./src/api/auth";
import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import AdminScreen from "./src/screens/AdminScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const rawDriver = await AsyncStorage.getItem("driver");
        const driver = rawDriver ? JSON.parse(rawDriver) : null;

        if (driver?.role === "admin") {
          setInitialRoute("Admin");
        } else if (driver) {
          setInitialRoute("Home");
        } else {
          // 토큰만 있고 driver 정보가 없는 경우를 위한 처리
          const token = await AsyncStorage.getItem("token");
          if (token) {
            try {
              const response = await fetch(`${API_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (response.ok) {
                const data = await response.json();
                const user = data.user;
                await AsyncStorage.setItem("driver", JSON.stringify(user));
                
                if (user.role === "admin") {
                  setInitialRoute("Admin");
                } else {
                  setInitialRoute("Home");
                }
                return;
              }
            } catch (e) {
              console.log("Token validation failed:", e);
            }
          }
          setInitialRoute("Login");
        }
      } catch {
        setInitialRoute("Login");
      }
    };
    bootstrap();
  }, []);

  if (!initialRoute) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: true }}
      >
        <Stack.Screen name="Login" component={LoginScreen} options={{ title: "로그인" }} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "홈" }} />
        <Stack.Screen name="Admin" component={AdminScreen} options={{ title: "관리자 대시보드" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}