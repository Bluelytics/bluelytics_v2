import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as React from 'react';

import TabBarIcon from './TabBarIcon';
import ValueScreen from '../screens/ValueScreen';
import CalculatorScreen from '../screens/CalculatorScreen';
import SettingsScreen from '../screens/SettingsScreen';

const BottomTab = createBottomTabNavigator();
const INITIAL_ROUTE_NAME = 'Value';

export default function BottomNavigator({ navigation, route }) {
  // Set the header title on the parent stack navigator depending on the
  // currently active tab. Learn more in the documentation:
  // https://reactnavigation.org/docs/en/screen-options-resolution.html
  navigation.setOptions({ headerTitle: getHeaderTitle(route) });

  return (
    <BottomTab.Navigator initialRouteName={INITIAL_ROUTE_NAME}>
      <BottomTab.Screen
        name="Value"
        component={ValueScreen}
        options={{
          title: 'Valor',
          tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="dollar" />,
        }}
      />
      <BottomTab.Screen
        name="Calculator"
        component={CalculatorScreen}
        options={{
          title: 'Calculadora',
          tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="calculator" />,
        }}
      />
      <BottomTab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Alertas',
          tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="warning" />,
        }}
      />
    </BottomTab.Navigator>
  );
}

function getHeaderTitle(route) {
  const routeName = route.state?.routes[route.state.index]?.name ?? INITIAL_ROUTE_NAME;

  switch (routeName) {
    case 'Value':
      return 'Cotizacion Dolar-ARS';
    case 'Calculator':
      return 'Calculadora Blue';
    case 'Settings':
      return 'Alertas';
  }
}
